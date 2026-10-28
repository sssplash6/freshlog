import "server-only";

import type { Attendance, TodoRow } from "@/lib/api/v1/types";
import { ATTENDANCE } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import type { Status } from "@/lib/status";

/**
 * One of freshform's statuses as a row of the app's To do list.
 *
 * The words are the website's own: `lib/status.ts` wrote them in the reader's
 * voice, and nothing here chooses a label or a colour. What the row adds is what
 * the app needs to act on it without opening one of the website's links, which
 * it cannot: a session to confirm, or a session to log with its form filled in.
 *
 * Both homes use it (the mentor's, and the student's). A row never carries an
 * instant: `Status.at` only orders the list, and the list leaves here in order.
 */

/** The colour slot of each program, by id. */
export type ProgramColors = ReadonlyMap<string, number>;

/**
 * The colour slots of the programs these rows name.
 *
 * A status names its program by id and name; the dot it wears is a column of the
 * program (`Program.colorIndex`), so the rows of one list are looked up
 * together, in one read, and none when no row names a program.
 */
export async function programColors(rows: readonly Pick<Status, "program">[]): Promise<ProgramColors> {
  const ids = [...new Set(rows.flatMap((row) => (row.program ? [row.program.id] : [])))];
  if (ids.length === 0) return new Map();
  const programs = await prisma.program.findMany({
    where: { id: { in: ids } },
    select: { id: true, colorIndex: true },
  });
  return new Map(programs.map((p) => [p.id, p.colorIndex]));
}

/**
 * `status` as the contract's row.
 *
 * `colors` is `programColors` of the list it came from. A program it does not
 * hold (one deleted since the list was read) wears the first slot, and a row
 * with no program needs none.
 *
 * `status.sessionId` is the session a SESSION_UNCONFIRMED row asks the student
 * to confirm. A row about several, as a roll-up is, has none.
 */
export function toTodoRow(status: Status, colors: ProgramColors = new Map()): TodoRow {
  const { subject, program, sessionId } = status;
  return {
    // The app keys its list on this, so no two rows of one answer may share it.
    // A student whose time runs out in two programs is two rows about one
    // subject, and a rolled-up row, which has no subject, is told apart by its
    // program: so the type, the subject and the program, each blank when absent.
    // A session to confirm names only the mentor who logged it, and one mentor
    // logs several, so it adds its session.
    key: [status.type, subject?.id ?? "", program?.id ?? "", ...(sessionId ? [sessionId] : [])].join(":"),
    type: status.type,
    severity: status.severity,
    label: status.label,
    explanation: status.explanation ?? null,
    // Copied field by field. A status can hold more than its type says
    // (`exchangeStatuses` hands over the whole program row it read), and none of
    // it belongs on a phone.
    subject: subject ? { kind: subject.kind, id: subject.id, name: subject.name } : null,
    program: program ? { id: program.id, name: program.name, colorIndex: colors.get(program.id) ?? 0 } : null,
    count: status.count ?? null,
    href: status.href ?? null,
    sessionId: sessionId ?? null,
    log: logOf(status),
  };
}

/**
 * A whole list of statuses as the contract's rows, in the order given. It is the
 * one way a list leaves here, for two things a row on its own cannot see.
 *
 * Colours: a program's dot is a column of the program, so the list's programs are
 * read together (`programColors`) and every row is given its own. Without them a
 * row wears the first slot, whichever program it names.
 *
 * Keys: `toTodoRow` makes a key from what its row is about, which tells nearly
 * every pair of rows apart and not every one. A student sent to one host program
 * from two of a mentor's programs is two rows of one kind about one student in one
 * program. The app keys its list on `key`, so the list holds what the formula
 * cannot: the second and later rows to share a key take `#2`, `#3` and so on, in
 * order. `#` is in no id and no type, so a numbered key is never another row's.
 */
export async function toTodoRows(statuses: readonly Status[]): Promise<TodoRow[]> {
  const colors = await programColors(statuses);
  const seen = new Map<string, number>();
  return statuses.map((status) => {
    const row = toTodoRow(status, colors);
    const times = (seen.get(row.key) ?? 0) + 1;
    seen.set(row.key, times);
    return times === 1 ? row : { ...row, key: `${row.key}#${times}` };
  });
}

/** What a row about time or a meeting lets the mentor log, prefilled. */
function logOf(status: Status): TodoRow["log"] {
  const { subject, program } = status;
  // Time running out for a student: the mentor's answer is a meeting. A rolled-up
  // row is about a count and names no student, so there is nothing to prefill.
  if (status.type === "ALLOCATION_EXPIRING" && subject?.kind === "student") {
    return { studentProfileId: subject.id, programId: program?.id ?? null, minutes: null, day: null, attendance: null };
  }
  if (status.type === "MEETING_TO_LOG" && status.href) return logOfMeeting(status.href);
  return null;
}

const ATTENDANCES: readonly Attendance[] = Object.values(ATTENDANCE);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The form `meetDraftStatuses` links to, read back out of its link.
 *
 * The link is where freshform has already put what Google Meet measured, and its
 * query is the one place that says which student it was: the row's subject is
 * the meeting's draft, not the student (a dismissal is keyed on it, so that
 * dismissing one meeting does not silence the next).
 *
 * A value that is not one of its kind is left blank for the mentor to fill in.
 */
function logOfMeeting(href: string): TodoRow["log"] {
  const query = new URL(href, "https://freshform.invalid").searchParams;
  const studentProfileId = query.get("studentProfileId");
  if (!studentProfileId) return null;

  const minutes = Number(query.get("minutes"));
  const day = query.get("date");
  return {
    studentProfileId,
    programId: query.get("programId") || null,
    minutes: Number.isInteger(minutes) && minutes > 0 ? minutes : null,
    day: day !== null && ISO_DAY.test(day) ? day : null,
    attendance: ATTENDANCES.find((a) => a === query.get("attendance")) ?? null,
  };
}
