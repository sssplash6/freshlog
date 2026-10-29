import "server-only";

import type {
  ApiSession,
  SessionsPage,
  SessionsQuery,
  SessionState,
  StudentAnswer,
} from "@/lib/api/v1/types";
import {
  adminScope,
  adminWriteScope,
  canManageStudent,
  mentorReaches,
  scopeCovers,
  scopeIsEmpty,
  scopeProgramFilter,
  studentScope,
  type AdminScope,
} from "@/lib/authz";
import {
  attendanceOf,
  canActAsMentor,
  CHARGED_SESSION,
  chargesAllocation,
  CONFIRM_WINDOW_DAYS,
  ROLES,
  SESSION_ANSWER,
  SESSION_STATUS,
  timeKindOf,
  USER_STATUS,
} from "@/lib/constants";
import { readParam, sessionsWhere, type FilterScope, type SearchParams } from "@/lib/filters";
import { toDateInputValue } from "@/lib/format";
import { MEETINGS_PER_PAGE, notHeldNote } from "@/lib/session-entries";
import { interviewsForLog } from "@/lib/student-interviews";
import { prisma } from "@/lib/prisma";
import { sessionStatuses, type Audience } from "@/lib/status";
import type { Prisma, Session, User } from "@/generated/prisma/client";

/**
 * Logged sessions as the freshlog app reads them, one at a time or a page at a
 * time.
 *
 * The website has no page for one session (a row's people carry the links,
 * `components/session-row.tsx`), so it never had to say who may read one. The
 * rule here is built from the rules the session actions already enforce, and
 * `sessions.test.ts` holds the two together: what `can` offers, the action
 * then allows.
 */

/** Who is reading, with what they may read and write. Built once per request. */
export type Reader = { user: User; studentProfileId: string | null; read: AdminScope; write: AdminScope };

/** `user` as a reader: their student record, when they have one, and the programs they read and write. */
export async function readerFor(user: User): Promise<Reader> {
  const [profile, read, write] = await Promise.all([
    prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true } }),
    adminScope(user),
    adminWriteScope(user),
  ]);
  return { user, studentProfileId: profile?.id ?? null, read, write };
}

/**
 * The include every session read uses. Each relation selects only what the
 * contract names, and the programs the student is in, which `can.restore` is
 * decided from and which are never sent; so nothing else of a person is ever
 * loaded to be mapped away.
 */
export const SESSION_INCLUDE = {
  student: {
    select: {
      id: true,
      userId: true,
      user: { select: { name: true, email: true } },
      enrollments: { select: { programId: true } },
    },
  },
  mentor: { select: { id: true, name: true, email: true } },
  program: { select: { id: true, name: true, colorIndex: true } },
  assignment: { select: { id: true, purpose: true } },
} satisfies Prisma.SessionInclude;

export type SessionRow = Prisma.SessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

const isStudentOf = (reader: Reader, row: Pick<Session, "studentId">) =>
  reader.studentProfileId !== null && row.studentId === reader.studentProfileId;

/**
 * May `reader` see this session: its student, the mentor who logged it, or
 * anyone whose read scope covers its program. `canReadSession` adds the one
 * reader more the website's student page shows it to: another mentor who
 * reaches the student.
 *
 * The session's own program decides the admin half, never the student's
 * enrollments (AGENTS.md, "Ask the row, not the student"): an admin of one of a
 * student's two programs reads that program's sessions and not the other's.
 */
export function canRead(reader: Reader, row: Pick<Session, "studentId" | "mentorId" | "programId">): boolean {
  return isStudentOf(reader, row) || row.mentorId === reader.user.id || scopeCovers(reader.read, row.programId);
}

/**
 * `canRead`, and another mentor who reaches the student, as the website's
 * student page shows them the student's whole ledger (parity T13). Such a
 * reader reads it, and changes nothing: `can` asks who logged it and who runs
 * its program.
 *
 * Only a mentor who doesn't also run one of the student's programs: the page
 * reads somebody who does as staff, narrowed to the programs they run
 * (`studentScope`), and a session in another program is not on it.
 */
async function canReadSession(reader: Reader, row: Pick<Session, "studentId" | "mentorId" | "programId">): Promise<boolean> {
  if (canRead(reader, row)) return true;
  if (!canActAsMentor(reader.user)) return false;
  const profile = await prisma.studentProfile.findUnique({
    where: { id: row.studentId },
    select: { id: true, enrollments: { select: { programId: true } } },
  });
  if (!profile || (await canManageStudent(reader.user, profile))) return false;
  return mentorReaches(reader.user, profile);
}

/**
 * A person as a row names them: their name, or their email when they have none.
 * The contract's naming rule (`PersonRef`), by which the session reads and both
 * homes name people.
 */
export const nameOf = (person: { name: string | null; email: string }) => person.name ?? person.email;

/**
 * One session in the contract's shape, as `reader` may be told it.
 *
 * It takes a row the reader may already see, from `canRead` or from a list that
 * asked only for their own, and decides what each field says to them.
 */
export function toApiSession(
  reader: Reader,
  row: SessionRow,
  now: Date,
  {
    reachesStudent = false,
    asMentor = false,
  }: {
    /** The reader reaches the student as their mentor: the student's page shows them every mentor's notes. */
    reachesStudent?: boolean;
    /**
     * Read in the mentor's words whatever grants the reader holds: a mentor's
     * own record, which the website keeps anonymous to them (no stars, the
     * student's note only on a dispute).
     */
    asMentor?: boolean;
  } = {}
): ApiSession {
  const isStudent = isStudentOf(reader, row);
  const loggedIt = row.mentorId === reader.user.id;
  // Whose words the row is in, as the website's pages read it: the student's
  // own; staff for the program's admins (the Sessions page reads every row of a
  // reader who administers as staff); a mentor's for anyone else.
  const audience: Audience = isStudent ? "student" : !asMentor && scopeCovers(reader.read, row.programId) ? "staff" : "mentor";
  const disputed = row.studentAnswer === SESSION_ANSWER.DISPUTED;
  const voided = row.status === SESSION_STATUS.VOIDED;
  // Who may correct it, void it and restore it: the mentor who logged it, while
  // they are an active mentor, and anyone who may write its program. The same
  // two `requireSessionAuthority` and `restoreSession` let through, asked of a
  // row already in hand.
  const corrects =
    (loggedIt && canActAsMentor(reader.user) && reader.user.status === USER_STATUS.ACTIVE) ||
    scopeCovers(reader.write, row.programId);

  return {
    id: row.id,
    day: toDateInputValue(row.date),
    minutes: row.minutes,
    attendance: attendanceOf(row),
    kind: timeKindOf(row),
    // A string column that constants.ts keeps to these values, like `studentAnswer` below.
    state: row.status as SessionState,
    charged: chargesAllocation(row),
    answer: row.studentAnswer as StudentAnswer | null,
    // The website's row: what the student said is for the student and staff
    // (`showFeedback`), and anonymous to a mentor, but a dispute is addressed to
    // the mentor, so its words reach them too. The stars never do.
    answerNote: audience !== "mentor" || disputed ? row.studentNote : null,
    answerRating: audience !== "mentor" ? row.studentRating : null,
    // The page's chips, minus the student's own "You confirmed this", which it
    // leaves off every row of their list.
    statuses: sessionStatuses(row, { audience, userId: reader.user.id, now })
      .filter((st) => !(audience === "student" && st.type === "SESSION_CONFIRMED"))
      .map((st) => ({ type: st.type, label: st.label, severity: st.severity, explanation: st.explanation ?? null })),
    // The website's own question, its window included: is the student being asked?
    needsAnswer: sessionStatuses(row, { audience: "student", userId: row.student.userId, now }).some(
      (status) => status.type === "SESSION_UNCONFIRMED"
    ),
    student: { id: row.student.id, userId: row.student.userId, name: nameOf(row.student.user) },
    mentor: { id: row.mentor.id, name: nameOf(row.mentor) },
    program: { id: row.program.id, name: row.program.name, colorIndex: row.program.colorIndex },
    task: row.assignment ? { id: row.assignment.id, purpose: row.assignment.purpose } : null,
    // `withoutMentorNotes`' rule: the write-up is for the mentor who wrote it and
    // the people who run the program, and never for the student it is about,
    // even one who also administers it.
    note: !isStudent && (loggedIt || reachesStudent || scopeCovers(reader.read, row.programId)) ? row.note : null,
    can: {
      edit: corrects && !voided,
      void: corrects && !voided,
      // By the same people, as the website's row offers it. A student who has
      // since left the session's program is `restoreSession`'s to refuse, in its
      // words, as the website's Restore is: voiding is how a student is cleared
      // off one, so a voided session can outlive the membership it was logged
      // under.
      restore: corrects && voided,
      // `answerSession`: the student, about a session that still stands.
      answer: isStudent && row.status === SESSION_STATUS.ACTIVE,
    },
  };
}

/** The session as `reader` may see it; null when it doesn't exist or isn't theirs to see. */
export async function sessionFor(reader: Reader, id: string, now: Date = new Date()): Promise<ApiSession | null> {
  const row = await prisma.session.findUnique({ where: { id }, include: SESSION_INCLUDE });
  // Loaded first and gated second, with one answer for both: a session that
  // isn't theirs must read exactly like one that doesn't exist.
  if (!row) return null;
  if (canRead(reader, row)) return toApiSession(reader, row, now);
  return (await canReadSession(reader, row)) ? toApiSession(reader, row, now, { reachesStudent: true }) : null;
}

/**
 * The note the session's row holds, whatever the reader was shown of it, for
 * `editForm` to keep when an edit leaves the note out. It goes to the action and
 * nowhere else. A session that doesn't exist has none.
 */
export async function storedNote(id: string): Promise<string | null> {
  const row = await prisma.session.findUnique({ where: { id }, select: { note: true } });
  return row?.note ?? null;
}

/* ------------------------------------------------------------------ the ledger --- */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many sessions a page holds when the request does not say, and the most it may ask for. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Whose sessions `reader`'s list holds: a student's own, else the ones a mentor
 * logged, else nobody's (null, which the route answers with a 404).
 *
 * "A student" is what `/me` puts first in `roles` and what the website's lens
 * calls `inStudentLens`: their role, and not only a student record, which a
 * mentor who was once a student still has. A student who also mentors reads
 * their own here, for the same reason `roles` lists them first.
 *
 * `as` is the side of the app asking. `"mentor"` is its mentor side, and is
 * answered with the ones the reader logged whatever else they are, which is how
 * a student who also mentors reads those; somebody who can't act as a mentor
 * has no such list.
 *
 * `"admin"` is its admin side: every session in the programs the reader
 * reads, at any level of grant, as the website's /sessions reads them for
 * staff. Somebody who reads no program has no such list. Left out, an admin
 * who does not mentor still has no ledger: the side of the app asks.
 */
export function ledgerScope(reader: Reader, as?: SessionsQuery["as"]): FilterScope | null {
  const { user, studentProfileId } = reader;
  // The student's page is `recordScope`'s, which has to read the student.
  if (as === "record") return null;
  // The website's Sessions page reads a mentor who administers programs as
  // staff of those programs, with Mine to narrow to their own: the sessions they
  // logged in a program they don't run are not on it (parity D4), so they are not
  // on the app's either.
  if (as === "mentor") {
    if (!canActAsMentor(user)) return null;
    const runs = adminRead(reader);
    return runs === null ? { mentorId: user.id } : { audience: "staff", userId: user.id, programIds: runs, mentorId: user.id };
  }
  if (as === "admin") {
    return scopeIsEmpty(reader.read) ? null : { audience: "staff", userId: user.id, programIds: scopeProgramFilter(reader.read) };
  }
  if (user.role === ROLES.STUDENT && studentProfileId !== null) return { studentId: studentProfileId };
  if (canActAsMentor(user)) return { mentorId: user.id };
  return null;
}

/**
 * The student's whole ledger as the website's student page shows it to
 * `reader` (`as=record`): an admin of one of their programs reads those
 * programs' sessions, as staff; a mentor who reaches them reads every one, every
 * mentor's, as a mentor. Anyone else, and a student who is not there, has none.
 */
export async function recordScope(reader: Reader, studentId: string | undefined): Promise<FilterScope | null> {
  const id = studentId?.trim();
  if (!id) return null;
  const profile = await prisma.studentProfile.findUnique({ where: { id }, select: { id: true, enrollments: { select: { programId: true } } } });
  if (!profile) return null;
  const manages = await canManageStudent(reader.user, profile);
  const reaches = !manages && canActAsMentor(reader.user) && (await mentorReaches(reader.user, profile));
  if (!manages && !reaches) return null;
  return manages
    ? { audience: "staff", userId: reader.user.id, studentId: profile.id, programIds: await studentScope(reader.user, profile) }
    : { audience: "mentor", userId: reader.user.id, studentId: profile.id };
}

/** Whose sessions a list holds: the student's page's (`as=record`), or `ledgerScope`'s. */
export async function scopeFor(reader: Reader, query: SessionsQuery): Promise<FilterScope | null> {
  return query.as === "record" ? recordScope(reader, query.student) : ledgerScope(reader, query.as);
}

/**
 * The programs a reader administers, as the Sessions page's `scopeProgramFilter`
 * gives them: undefined for every program, null for none.
 */
function adminRead(reader: Reader): readonly string[] | undefined | null {
  if (scopeIsEmpty(reader.read)) return null;
  return scopeProgramFilter(reader.read);
}

/** The fields of the query that take one of a few words, rather than any text. */
type Choice = "period" | "status" | "answer" | "as" | "attendance" | "kind";

/**
 * The words each of them takes, keyed by the contract's own union: a word added
 * to `SessionsQuery` does not compile until it is here too, and a word that is
 * not there cannot be.
 */
const WORDS: { [Key in Choice]: Record<NonNullable<SessionsQuery[Key]>, true> } = {
  period: { week: true, "30d": true, "90d": true, year: true },
  status: { active: true, voided: true },
  answer: { needed: true, disputed: true },
  as: { mentor: true, admin: true, record: true },
  attendance: { attended: true, late: true, absent: true, rescheduled: true },
  kind: { plan: true, extra: true },
};

/**
 * The query a request's URL carries.
 *
 * This is where text becomes a `SessionsQuery`, so the rest of the ledger can
 * trust the type. A word the contract does not name is left out, and so is every
 * filter it does not have: `mentor`, `attendance`, `from` and the rest are the
 * website's, and never reach `sessionsWhere` from here. A key given twice means
 * its first value, as it does for the website's filters.
 */
export function sessionsQueryFrom(params: URLSearchParams): SessionsQuery {
  const text = (key: string) => params.get(key) ?? undefined;
  // Found among the table's own keys, so a name every object has ("toString") is no word.
  const word = <Key extends Choice>(key: Key) =>
    (Object.keys(WORDS[key]) as NonNullable<SessionsQuery[Key]>[]).find((w) => w === params.get(key));
  return {
    cursor: text("cursor"),
    limit: text("limit"),
    student: text("student"),
    mentor: text("mentor"),
    program: text("program"),
    period: word("period"),
    from: text("from"),
    to: text("to"),
    attendance: word("attendance"),
    kind: word("kind"),
    status: word("status"),
    answer: word("answer"),
    assignment: text("assignment"),
    q: text("q"),
    as: word("as"),
  };
}

/**
 * Where the page before ended: the three values the list is ordered by, and not
 * the row. A cursor that named a row would need that row, and by the time the
 * next page is asked for it may be gone.
 */
type Cursor = { date: Date; createdAt: Date; id: string };

/** The cursor that continues after `row`: the base64url of `[date, createdAt, id]`, the two instants in ISO 8601. */
const cursorAfter = (row: Pick<Session, "date" | "createdAt" | "id">): string =>
  Buffer.from(JSON.stringify([row.date.toISOString(), row.createdAt.toISOString(), row.id])).toString("base64url");

/** The instant `text` spells, when it spells it exactly as `toISOString` does; otherwise it is not one a cursor made. */
function instantOf(text: unknown): Date | null {
  if (typeof text !== "string") return null;
  const at = new Date(text);
  return Number.isNaN(at.getTime()) || at.toISOString() !== text ? null : at;
}

/** The cursor `text` is, or null when `cursorAfter` could not have made it. */
function readCursor(text: string): Cursor | null {
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(parts) || parts.length !== 3) return null;
  const [rawDate, rawCreatedAt, id] = parts;
  const date = instantOf(rawDate);
  const createdAt = instantOf(rawCreatedAt);
  if (!date || !createdAt || typeof id !== "string" || id === "") return null;
  return { date, createdAt, id };
}

/**
 * Every session that comes after `cursor` in the list's order (date, then
 * createdAt, then id, each descending), and none that comes before it or is it.
 * Two sessions can share a day, and two can share the instant they were logged;
 * the id is what tells those apart, so no row is on two pages or on none.
 */
const after = ({ date, createdAt, id }: Cursor): Prisma.SessionWhereInput => ({
  OR: [{ date: { lt: date } }, { date, createdAt: { lt: createdAt } }, { date, createdAt, id: { lt: id } }],
});

/** The page size `text` asks for: 1 to 100 as digits, and the default for anything else. */
function limitOf(text: string | undefined): number {
  const asked = text !== undefined && /^\d+$/.test(text) ? Number(text) : NaN;
  return asked >= 1 && asked <= MAX_LIMIT ? asked : DEFAULT_LIMIT;
}

/**
 * The sessions the website would still ask the student about: active, in the
 * plan, unanswered, and not older than `sessionStatuses` keeps asking. That is
 * `daysSince(date) <= CONFIRM_WINDOW_DAYS`, so the earliest date is exactly that
 * many days before `now`, and `needsAnswer` and this list cannot disagree.
 */
const awaitingAnswer = (now: Date): Prisma.SessionWhereInput => ({
  ...CHARGED_SESSION,
  studentAnswer: null,
  date: { gte: new Date(now.getTime() - CONFIRM_WINDOW_DAYS * DAY_MS) },
});

/**
 * What the student disputed and nobody has voided since. The one rule for it:
 * the ledger's `answer=disputed` and its `counts.disputed`, and the mentor's
 * home's `summary.disputed`, so the three cannot disagree.
 */
export const DISPUTED: Prisma.SessionWhereInput = {
  studentAnswer: SESSION_ANSWER.DISPUTED,
  status: { not: SESSION_STATUS.VOIDED },
};

/**
 * A mentor's search box over their own list: the note, the plan item and the
 * student's name. That is the website's `SESSION_SEARCH` (filters.ts) without
 * its "mentor" field, and the field is left out on purpose.
 *
 * Every session on this list is the reader's own, so their name is on all of
 * them, and a search that looked there would match every row for any text
 * inside it ("akm" in Akmal Karimov) and the box would not narrow at all. The
 * website keeps the field, for the people who read everybody's sessions and do
 * look one mentor up by name. `sessionsWhere` can't be asked to leave one field
 * out, and filters.ts is the website's search, so the clause is built here. It
 * is `contains` with no `mode`, as there: SQLite's LIKE is already
 * case-insensitive for ASCII, and Prisma throws if asked for `mode` on SQLite.
 *
 * So it must follow a change to `SESSION_SEARCH`. `sessions-page.test.ts` pins
 * that search's fields by the placeholder they make, so a change there fails a
 * test before it can go missing here.
 */
const mentorSearch = (q: string): Prisma.SessionWhereInput | null =>
  q
    ? {
        OR: [
          { note: { contains: q } },
          { assignment: { purpose: { contains: q } } },
          { student: { user: { name: { contains: q } } } },
        ],
      }
    : null;

/** One row of the `groupBy` the totals come from. */
type Group = {
  status: string;
  attended: boolean;
  withinPlan: boolean;
  _sum: { minutes: number | null };
  _count: { _all: number };
};

/**
 * The figures for every session a filter matches, in minutes (`count` is
 * sessions). They are the website's `/sessions` sums, plus the voided ones:
 *
 * - `charged`: active and in the plan, which is what draws a balance down
 * - `missed`: charged, and the student did not come
 * - `extra`: active and out of the plan
 * - `voided`: voided, whatever else it was
 *
 * A rescheduled session delivered nothing, so it is only in `count`.
 */
function totalsOf(groups: Group[]): SessionsPage["totals"] {
  const totals = { count: 0, charged: 0, missed: 0, extra: 0, voided: 0 };
  for (const group of groups) {
    const minutes = group._sum.minutes ?? 0;
    totals.count += group._count._all;
    if (group.status === SESSION_STATUS.VOIDED) {
      totals.voided += minutes;
    } else if (chargesAllocation(group)) {
      totals.charged += minutes;
      if (!group.attended) totals.missed += minutes;
    } else if (group.status === SESSION_STATUS.ACTIVE) {
      totals.extra += minutes;
    }
  }
  return totals;
}

/**
 * One page of `reader`'s sessions, latest first, with figures for the whole
 * filter and not only the page.
 *
 * Which sessions exist for them is `ledgerScope`; the query can only narrow
 * inside it (`sessionsWhere` ANDs the scope in ahead of everything the URL says).
 * Each row is mapped by `toApiSession`, which is where a student is told no
 * mentor note.
 *
 * The page is a keyset, not an offset: the next one is whatever comes after the
 * last row of this one. An offset would move when a session is logged between
 * two pages, and repeat or skip a row. A cursor that can't be read is refused,
 * and the route answers it with a 400.
 */
export async function sessionsPage(
  reader: Reader,
  query: SessionsQuery,
  now: Date = new Date()
): Promise<SessionsPage | { refused: string; field: string }> {
  const scope = await scopeFor(reader, query);
  // The route answers 404 before it asks, so this is for any other caller: a
  // reader with no ledger holds no sessions, and never anybody else's.
  if (!scope) {
    return {
      items: [],
      nextCursor: null,
      totals: totalsOf([]),
      counts: { disputed: 0, voided: 0 },
      programs: [],
      programFilter: [],
      mentor: null,
      notHeld: null,
    };
  }

  let cursor: Cursor | null = null;
  if (query.cursor) {
    cursor = readCursor(query.cursor);
    if (!cursor) return { refused: "Load the list again.", field: "cursor" };
  }
  const limit = limitOf(query.limit);

  // `q` searches the mentor's notes, and a student must not learn what those
  // say from what a search matches, so a student's is dropped. `student` is a
  // mentor's or an admin's way of picking one of theirs; a student has only
  // themselves.
  const asMentor = scope.mentorId !== undefined;
  const asStaff = query.as === "admin";
  const asRecord = query.as === "record";
  // Staff search the website's own box, the mentor's name included: they read
  // everybody's sessions in their programs, and do look one mentor up by name.
  const filters: SearchParams = {
    program: query.program,
    attendance: query.attendance,
    kind: query.kind,
    ...(asMentor || asStaff ? { student: query.student } : {}),
    ...(asStaff ? { q: query.q, mentor: query.mentor?.trim() } : {}),
  };
  // `readParam` reads the box as the website does: trimmed, at most 200
  // characters, and nothing at all when it is blank.
  const search = asMentor ? mentorSearch(readParam({ q: query.q }, "q")) : null;
  const searched = search ? [search] : [];
  const answer =
    query.answer === "needed" ? awaitingAnswer(now) : query.answer === "disputed" ? DISPUTED : null;
  const narrowed = sessionsWhere(
    { ...filters, period: query.period, from: query.from, to: query.to, status: query.status },
    scope,
    now
  );
  // One plan item, inside the scope above: a word that is no plan item's id matches no session. Blank narrows nothing.
  const assignment = query.assignment?.trim();
  const planItem: Prisma.SessionWhereInput[] = assignment ? [{ assignmentId: assignment }] : [];
  // One mentor, on a student's own list (their mentor's page); a mentor's and an admin's list ignore it.
  const mentor = !asMentor && !asStaff ? query.mentor?.trim() : undefined;
  const withMentor: Prisma.SessionWhereInput[] = mentor ? [{ mentorId: mentor }] : [];
  const where: Prisma.SessionWhereInput = { AND: [narrowed, ...searched, ...planItem, ...withMentor, ...(answer ? [answer] : [])] };
  // The chips on the status row: the filter without its period, status and answer.
  const chips: Prisma.SessionWhereInput = { AND: [sessionsWhere(filters, scope, now), ...searched, ...planItem, ...withMentor] };

  // The website's Program select: every program a reader who administers runs,
  // and only when that is more than one. A mentor who runs none has none.
  const runs = scope.audience === "staff" && !asRecord ? adminRead(reader) : null;
  const named = asStaff ? readParam({ mentor: query.mentor }, "mentor") : "";
  const [rows, groups, disputed, voided, programs, runPrograms, namedMentor, notHeld] = await Promise.all([
    prisma.session.findMany({
      where: cursor ? { AND: [where, after(cursor)] } : where,
      include: SESSION_INCLUDE,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      // One more than the page, which is how to know there is another.
      take: limit + 1,
    }),
    prisma.session.groupBy({
      by: ["status", "attended", "withinPlan"],
      where,
      _sum: { minutes: true },
      _count: { _all: true },
    }),
    prisma.session.count({ where: { AND: [chips, DISPUTED] } }),
    prisma.session.count({ where: { AND: [chips, { status: SESSION_STATUS.VOIDED }] } }),
    // Their own sessions with no filter at all, so the menu does not shrink
    // to the program that is picked.
    prisma.program.findMany({
      where: { sessions: { some: sessionsWhere({}, scope, now) } },
      select: { id: true, name: true, colorIndex: true },
      orderBy: { name: "asc" },
    }),
    runs === null
      ? Promise.resolve([])
      : prisma.program.findMany({
          where: runs ? { id: { in: [...runs] } } : {},
          select: { id: true, name: true, colorIndex: true },
          orderBy: { name: "asc" },
        }),
    // Named only when they logged a session the reader may read, so an id is no
    // way to learn anybody else's name.
    named
      ? prisma.user.findFirst({
          where: { id: named === "me" ? reader.user.id : named, mentorSessions: { some: sessionsWhere({}, scope, now) } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve(null),
    scope.studentId !== undefined && query.as === undefined ? notHeldOf(reader, scope.studentId, now) : Promise.resolve(null),
  ]);

  const items = rows.slice(0, limit);
  return {
    items: items.map((row) => toApiSession(reader, row, now, { reachesStudent: asRecord })),
    nextCursor: rows.length > limit ? cursorAfter(items[items.length - 1]) : null,
    totals: totalsOf(groups),
    counts: { disputed, voided },
    programs,
    programFilter: runPrograms.length > 1 ? runPrograms : [],
    mentor: namedMentor ? { id: namedMentor.id, name: nameOf(namedMentor) } : null,
    notHeld,
  };
}

/**
 * The website's footer under a student's Past meetings (`notHeldNote`): how
 * many of their sessions were voided or rescheduled, said only when the log,
 * sessions and past practice interviews together, runs past one page.
 */
async function notHeldOf(reader: Reader, studentId: string, now: Date): Promise<string | null> {
  const [sessions, interviews] = await Promise.all([
    prisma.session.findMany({ where: { studentId }, select: { status: true } }),
    interviewsForLog(reader.user.id, now),
  ]);
  if (sessions.length + interviews.length <= MEETINGS_PER_PAGE) return null;
  return notHeldNote(sessions) ?? null;
}
