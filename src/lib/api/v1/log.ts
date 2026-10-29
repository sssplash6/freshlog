import "server-only";

import { nameOf, type Reader } from "@/lib/api/v1/sessions";
import { isMinutes, isOneOf, isText } from "@/lib/api/v1/session-forms";
import type {
  Attendance,
  LogOptions,
  PersonRef,
  LogProgram,
  LogSessionRequest,
  LogStudent,
  TimeKind,
} from "@/lib/api/v1/types";
import { scopeIsEmpty, scopeProgramFilter } from "@/lib/authz";
import { ATTENDANCE, SESSION_STATUS, TIME_KIND } from "@/lib/constants";
import { mentorsWhere } from "@/lib/filters";
import { toDateInputValue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { logSessionOptions, mentorCaseload, type CaseloadStudent, type MentorCaseload } from "@/lib/queries";
import { TASK_OTHER, TASK_PRESETS } from "@/lib/tasks";
import { programToday } from "@/lib/when";
import type { User } from "@/generated/prisma/client";

/**
 * Logging a session from the freshlog app: who a mentor can log for, and the
 * form the log goes in by.
 *
 * Neither rule is new. Who is offered, in what order, in what state and with
 * which plan items is `logSessionOptions`, which the website's /sessions/new
 * page calls, so the app never offers somebody the log would then refuse. The
 * log itself is `logSession`, the website's own action.
 */

/** How many of the mentor's latest sessions are read, and how many of the student and program pairs found in them the app is told about. */
const RECENT_READ = 50;
const RECENT_KEPT = 8;

/**
 * Who `user` can log a session for, how many minutes each has to draw on, and
 * their latest sessions by the day they were held, one per student and program.
 *
 * `user` is the mentor whose meeting it is. The route has already asked whether
 * they can act as one. When an admin logs on their behalf, `programIds` is the
 * admin's write scope (`undefined` for a platform admin), and everything is
 * narrowed to it, as the website's /sessions/new narrows it: `logSession`
 * refuses an on-behalf log in a program the admin may not change, so the sheet
 * must never offer one.
 */
export async function logOptionsFor(
  user: User,
  now: Date = new Date(),
  onBehalf?: { programIds: readonly string[] | undefined; program?: string }
): Promise<LogOptions> {
  const inScope = onBehalf?.programIds ? { programId: { in: [...onBehalf.programIds] } } : {};
  const [caseload, latest] = await Promise.all([
    mentorCaseload(user.id),
    prisma.session.findMany({
      where: { mentorId: user.id, status: { not: SESSION_STATUS.VOIDED }, ...inScope },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: RECENT_READ,
      select: { studentId: true, programId: true, minutes: true },
    }),
  ]);
  const students = studentsOf(caseload, onBehalf?.programIds);
  // `?program=`, from a program's page: the website's log page offers only the students in it.
  const inProgram = onBehalf?.program ? students.filter((s) => s.programs.some((p) => p.program.id === onBehalf.program)) : students;
  return { today: programToday(now), students: inProgram, recent: recentOf(latest), planPresets: [...TASK_PRESETS] };
}

/**
 * The students `logSessionOptions` lists, in its order, with the figures from
 * the caseload row for the same student and program (`figuresOf`).
 *
 * The row is found by both: a student held in two programs is two rows with two
 * balances and two deadlines, and a key without the program would spend one
 * program's hours out of the other's grant (AGENTS.md, "A student's program is a
 * set"). Its English `balance` and `hint` are left out: the app says its own,
 * from the figures.
 */
function studentsOf(caseload: MentorCaseload, programIds?: readonly string[]): LogStudent[] {
  const rows = new Map<string, CaseloadStudent>();
  for (const row of caseload.students) {
    const key = `${row.profile.id}:${row.program.id}`;
    if (!rows.has(key)) rows.set(key, row);
  }
  // A program's dot. Every program offered is on a caseload row or on one of the
  // mentor's pairings (`assignments`), which is where the programs of a student
  // they merely share one with come from.
  const dots = new Map<string, number>();
  for (const { program } of [...caseload.assignments, ...caseload.students]) dots.set(program.id, program.colorIndex);

  // Its English is left out (see above), so no `mentorName`: only the narrowing.
  return logSessionOptions(caseload, { programIds }).map((option) => ({
    id: option.profileId,
    name: option.label,
    programs: option.programs.map((choice) => ({
      program: { id: choice.value, name: choice.label, colorIndex: dots.get(choice.value) ?? 0 },
      state: choice.state,
      ...figuresOf(rows.get(`${option.profileId}:${choice.value}`), choice.state),
      goals: choice.goals.map(({ value, label }) => ({ id: value, label })),
    })),
  }));
}

/**
 * `remaining`, `allocated` and `useBy` of one program choice: the caseload row
 * for the student and program (none for a student the mentor merely shares a
 * program with) and the `state` `logSessionOptions` gave it.
 *
 * `remaining` is the figure `state` was decided from, so the two cannot
 * disagree. Where the student's hours are in an unassigned pool or an hour bank,
 * that is what the pool or bank holds (`row.pool`, negative for an overdrawn
 * bank): a log claims it from the pool or draws the bank, whoever holds the
 * meeting. Otherwise it is what is left of the mentor's own grant. When `state`
 * is none it is null, which also covers a grant set down to nothing: the picker
 * calls that no time, whatever was charged against it before.
 *
 * `allocated` is only the mentor's own grant, so it is null for a pool or a
 * bank (their rows carry none) and for a grant of nothing. `useBy` is the use-by
 * day of the hours `remaining` counts.
 */
function figuresOf(
  row: CaseloadStudent | undefined,
  state: LogProgram["state"]
): Pick<LogProgram, "remaining" | "allocated" | "useBy"> {
  if (!row || state === "none") return { remaining: null, allocated: null, useBy: null };
  return {
    remaining: row.pool ?? row.remaining,
    allocated: row.allocated > 0 ? row.allocated : null,
    useBy: row.deadline ? toDateInputValue(row.deadline) : null,
  };
}

/**
 * The first of each student and program pair among `sessions`, which arrive
 * newest first, at most `RECENT_KEPT` of them: the quick picks, and how long
 * the pair's meetings usually run.
 *
 * The pair, not the student: what a mentor logs with one student in the Master's
 * Program says nothing about the length of a Global Admissions meeting.
 */
function recentOf(sessions: { studentId: string; programId: string; minutes: number }[]): LogOptions["recent"] {
  const seen = new Set<string>();
  const recent: LogOptions["recent"] = [];
  for (const { studentId, programId, minutes } of sessions) {
    const key = `${studentId}:${programId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recent.push({ studentProfileId: studentId, programId, minutes });
    if (recent.length === RECENT_KEPT) break;
  }
  return recent;
}

/**
 * A field of the request, the name `logSession` reads it by, and whether a value
 * of it is the right type. The checks are the ones an edit's fields pass
 * (session-forms.ts).
 */
type Field = readonly [request: keyof LogSessionRequest, form: string, accepts: (value: unknown) => boolean];

const FIELDS: readonly Field[] = [
  ["studentProfileId", "studentProfileId", isText],
  ["programId", "programId", isText],
  ["day", "date", isText],
  ["minutes", "minutes", isMinutes],
  ["attendance", "attendance", isOneOf<Attendance>(Object.values(ATTENDANCE))],
  ["kind", "timeKind", isOneOf<TimeKind>(Object.values(TIME_KIND))],
  ["note", "note", isText],
  ["assignmentId", "assignmentId", isText],
  ["mentor", "mentorId", isText],
];

/**
 * `logSession`'s FormData for the signed-in mentor, or the field of the request
 * that is the wrong type, by the name the request gives it.
 *
 * Only the fields the app sends are read, and the action is given the names the
 * website's form uses: `day` is its `date` and `kind` its `timeKind`. A field the
 * request leaves out is left out here too: the action has its own defaults for
 * attendance and kind, and words for a missing student, day or minutes.
 *
 * `mentor` becomes the action's `mentorId` only when `mayNameMentor`: the reader
 * may change some program, which is what `logSession` asks of somebody logging
 * for somebody else. Anybody else has it ignored, not honoured, and logs as
 * themselves, as before. The action decides the rest: the mentor is active,
 * reaches the student, and works in a program the admin may change.
 * `newPlanItem` is the website's "Add to their agenda": it becomes the form's
 * "Something else…" with its `agendaName`, which the action reads as a preset or
 * a typed name alike, and is refused beside an `assignmentId`. Right type is all
 * that is checked: wording and ranges (whole minutes, a real day, not in the
 * future) are the action's to say, in the website's words.
 */
export function logForm(body: Record<string, unknown>, mayNameMentor = false): FormData | { field: string } {
  const form = new FormData();
  for (const [request, name, accepts] of FIELDS) {
    const value = body[request];
    if (value === undefined) continue;
    if (request === "mentor" && !mayNameMentor) continue;
    if (!accepts(value)) return { field: request };
    form.set(name, String(value));
  }
  const named = body.newPlanItem;
  if (named !== undefined) {
    if (!isText(named) || body.assignmentId !== undefined) return { field: "newPlanItem" };
    form.set("assignmentId", TASK_OTHER);
    form.set("agendaName", named);
  }
  return form;
}

/**
 * The mentors `reader` may log a session for: those paired in a program the
 * reader may change, as the website's /sessions/new lists them (`mentorsWhere`),
 * by name. `program` narrows to one of those programs; one outside them names
 * nobody. The reader is among them when they mentor there too.
 */
export async function logMentorsFor(reader: Reader, program?: string): Promise<PersonRef[]> {
  const mentors = await prisma.user.findMany({
    where: mentorsWhere(program ? { program } : {}, { programIds: scopeProgramFilter(reader.write) }),
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: { id: true, name: true, email: true },
  });
  return mentors.map((m) => ({ id: m.id, name: nameOf(m) }));
}

/** The mentor `reader` names to log for, when they may log for them; null otherwise. */
export async function onBehalfMentor(reader: Reader, mentorId: string): Promise<User | null> {
  if (scopeIsEmpty(reader.write)) return null;
  return prisma.user.findFirst({
    where: { AND: [{ id: mentorId }, mentorsWhere({}, { programIds: scopeProgramFilter(reader.write) })] },
  });
}
