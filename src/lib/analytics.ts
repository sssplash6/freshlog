import "server-only";

import { avatarUrl } from "@/lib/avatar";
import { CHARGED_SESSION, PROGRAM_STATUS, SESSION_STATUS, drawKey } from "@/lib/constants";
import { deadlinePassed } from "@/lib/deadlines";
import { prisma } from "@/lib/prisma";

/**
 * Everything the analytics dashboard draws, read once and handed to the client
 * as compact rows so that drilling from the school into a program, a mentor, a
 * month and a day is instant — no round trip per click.
 *
 * WHICH SESSIONS. Active ones only: a voided session gave its time back and a
 * rescheduled one never happened. Each row is then one of three kinds, and the
 * words are the ledger's (`lib/hours.ts`):
 *
 *   COMPLETED  in plan and attended — the ledger's "Completed"
 *   EXTRA      out of plan, attended or not — charged to nobody
 *   NO_SHOW    in plan, and the student did not come — the ledger's "Missed",
 *              charged like any other meeting
 *
 * Plan first, then attendance, as the ledger asks it. An out-of-plan no-show
 * was a NO_SHOW here until 13 October 2026, so the same meeting was "missed"
 * on this page and "extra" on the mentor's own.
 *
 * WHOSE SESSIONS. `programIds` narrows to those programs; `undefined` is the
 * whole school, which is what `/analytics` reads for every mentor and member of staff. A session belongs to the program it names (`Session.programId`), never
 * to the student's enrollments — so a student in two programs contributes each
 * meeting to exactly one of them. Visits on an exchange count in the HOST
 * program, where they were logged and nowhere else: "hours are new, never
 * moved" (AGENTS.md), and a sending program that summed them too would be
 * counting the same hour twice.
 *
 * WHAT IS NOT SENT. No student names or ids: a student is an opaque index, used
 * only to count how many different people a mentor saw. Notes, ratings and
 * disputes stay on the pages that already govern them.
 *
 * GRANTED. Each program also carries the minutes ever allocated to its
 * students, so a program card can say how far through its grant the delivered
 * hours have come — the question "% of all hours" was being asked and could
 * not answer.
 *
 * FORFEITED (November 2026). And the minutes of those grants that passed their
 * use-by date unused, so the dashboard can say what is still left to deliver
 * — the program page's Remaining, `granted − drawn − forfeited` — and not a
 * figure that counts expired time as still to come.
 */

export const SESSION_KIND = { COMPLETED: 0, EXTRA: 1, NO_SHOW: 2 } as const;
export type SessionKind = (typeof SESSION_KIND)[keyof typeof SESSION_KIND];

/**
 * One session: [program, mentor, student, day, minutes, kind].
 *
 * `program` and `mentor` index the arrays beside it; `student` is an opaque
 * index; `day` is the program day as yyyymmdd. Session dates are stored at UTC
 * midnight of the Tashkent calendar day (`lib/when.ts`), so the UTC fields ARE
 * the program day and need no offset.
 */
export type AnalyticsRow = [
  program: number,
  mentor: number,
  student: number,
  day: number,
  minutes: number,
  kind: SessionKind,
];

export type AnalyticsProgram = {
  id: string;
  name: string;
  /**
   * The colour slot it wears everywhere else (`Program.colorIndex`). An
   * institute's levels are dealt slots in order; null is the "No level"
   * bucket, which is drawn neutral because it is not a place.
   */
  colorIndex: number | null;
  archived: boolean;
  /**
   * Minutes ever granted to the program's students — the stock the delivered
   * hours are read against ("4.4h of the 8h granted"). A stock, not a flow: it
   * does not narrow with the year picker the way the session rows do.
   */
  granted: number;
  /**
   * Of `granted`, the minutes lost to a passed use-by date: per allocation,
   * what it held less what its own meetings drew, once its deadline is gone —
   * the ledger's "expired unused" (`studentsWithHours`). A stock, like
   * `granted`, judged at the moment of the read.
   */
  forfeited: number;
};
export type AnalyticsMentor = { id: string; name: string; avatar: string | null };

export type AnalyticsData = {
  programs: AnalyticsProgram[];
  mentors: AnalyticsMentor[];
  rows: AnalyticsRow[];
};

export function kindOf(session: {
  withinPlan: boolean;
  attended: boolean;
}): SessionKind {
  if (!session.withinPlan) return SESSION_KIND.EXTRA;
  return session.attended ? SESSION_KIND.COMPLETED : SESSION_KIND.NO_SHOW;
}

export function dayKey(date: Date): number {
  return (
    date.getUTCFullYear() * 10000 +
    (date.getUTCMonth() + 1) * 100 +
    date.getUTCDate()
  );
}

export async function analyticsData(
  programIds: readonly string[] | undefined
): Promise<AnalyticsData> {
  const inScope = programIds ? { in: [...programIds] } : undefined;

  const [programs, sessions, grants] = await Promise.all([
    prisma.program.findMany({
      where: inScope ? { id: inScope } : {},
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true, colorIndex: true },
    }),
    prisma.session.findMany({
      where: {
        status: SESSION_STATUS.ACTIVE,
        ...(inScope ? { programId: inScope } : {}),
      },
      orderBy: { date: "asc" },
      select: {
        programId: true,
        studentId: true,
        minutes: true,
        date: true,
        withinPlan: true,
        attended: true,
        mentor: {
          select: { id: true, name: true, email: true, avatarUpdatedAt: true },
        },
      },
    }),
    grantsIn(programIds),
  ]);

  const programIndex = new Map(programs.map((p, i) => [p.id, i]));
  const granted = new Map<string, number>();
  const forfeited = new Map<string, number>();
  for (const g of grants) {
    granted.set(g.programId, (granted.get(g.programId) ?? 0) + g.minutes);
    forfeited.set(g.programId, (forfeited.get(g.programId) ?? 0) + g.forfeited);
  }
  const { mentors, rows } = toRows(sessions, (s) => programIndex.get(s.programId));

  return {
    programs: programs.map((p) => ({
      id: p.id,
      name: p.name,
      colorIndex: p.colorIndex,
      archived: p.status === PROGRAM_STATUS.ARCHIVED,
      granted: granted.get(p.id) ?? 0,
      forfeited: forfeited.get(p.id) ?? 0,
    })),
    mentors,
    rows,
  };
}

/** One allocation, as the dashboard needs it: what it granted and what of that expired unused. */
type Grant = { studentId: string; programId: string; minutes: number; forfeited: number };

/**
 * Every allocation in these programs (`undefined`: all of them), with the
 * minutes it forfeited.
 *
 * Worked out as `studentsWithHours` does it, so the dashboard's Remaining is
 * the program page's: an allocation is drawn only by the charging sessions
 * that draw IT (`drawKey` — a bank meeting draws the bank, any other meeting
 * that mentor's own time), and once its deadline passes, what it held beyond
 * them is lost. Charging sessions that match no allocation — a mentor whose
 * grant was later removed — forfeit nothing, and still count as drawn where
 * the dashboard sums its rows.
 */
async function grantsIn(programIds: readonly string[] | undefined): Promise<Grant[]> {
  const inScope = programIds ? { programId: { in: [...programIds] } } : {};
  const [allocations, drawn] = await Promise.all([
    prisma.hourAllocation.findMany({
      where: inScope,
      select: { studentId: true, programId: true, mentorId: true, isBank: true, minutes: true, deadline: true },
    }),
    prisma.session.groupBy({
      by: ["studentId", "programId", "mentorId", "fromBank"],
      where: { ...CHARGED_SESSION, ...inScope },
      _sum: { minutes: true },
    }),
  ]);
  const key = (r: { studentId: string; programId: string }, draws: string | null) =>
    `${r.studentId}:${r.programId}:${draws}`;
  const drawnBy = new Map<string, number>();
  for (const s of drawn) {
    const k = key(s, drawKey(s));
    drawnBy.set(k, (drawnBy.get(k) ?? 0) + (s._sum.minutes ?? 0));
  }
  const now = Date.now();
  return allocations.map((a) => ({
    studentId: a.studentId,
    programId: a.programId,
    minutes: a.minutes,
    forfeited: deadlinePassed(a.deadline, now)
      ? Math.max(0, a.minutes - (drawnBy.get(key(a, drawKey(a))) ?? 0))
      : 0,
  }));
}

/** A session as `toRows` needs it. */
type SessionRead = {
  programId: string;
  studentId: string;
  minutes: number;
  date: Date;
  withinPlan: boolean;
  attended: boolean;
  mentor: { id: string; name: string | null; email: string; avatarUpdatedAt: Date | null };
};

/**
 * Sessions as compact rows, with the mentors they name. `bucket` says which
 * entry of `programs` each one belongs to — the program it names, or, in an
 * institute's frame, the level its student is at — and a session it answers
 * `undefined` for is left out.
 */
function toRows(
  sessions: readonly SessionRead[],
  bucket: (s: SessionRead) => number | undefined
): { mentors: AnalyticsMentor[]; rows: AnalyticsRow[] } {
  const mentors: AnalyticsMentor[] = [];
  const mentorIndex = new Map<string, number>();
  const studentIndex = new Map<string, number>();
  const rows: AnalyticsRow[] = [];

  for (const s of sessions) {
    const program = bucket(s);
    if (program === undefined) continue;

    let mentor = mentorIndex.get(s.mentor.id);
    if (mentor === undefined) {
      mentor = mentors.length;
      mentorIndex.set(s.mentor.id, mentor);
      mentors.push({
        id: s.mentor.id,
        name: s.mentor.name?.trim() || s.mentor.email,
        avatar: avatarUrl(s.mentor),
      });
    }

    let student = studentIndex.get(s.studentId);
    if (student === undefined) {
      student = studentIndex.size;
      studentIndex.set(s.studentId, student);
    }

    rows.push([program, mentor, student, dayKey(s.date), s.minutes, kindOf(s)]);
  }
  return { mentors, rows };
}

/** The bucket for members of an institute at no level — visitors, mostly. */
export const NO_LEVEL_ID = "no-level";

/**
 * One institute's sessions, with its LEVELS standing where the programs stand
 * in the school's data — so the dashboard's own drill reads Institute › level
 * › mentor without a line of it knowing the difference.
 *
 * A session goes to the level its student is at NOW. The ledger keys on the
 * program and carries no level, so a student who moved up from Emerging takes
 * the hours they used there to Advanced: the chart answers "how much time has
 * this level's cohort of students had", not "how much was delivered at this
 * level". Sessions of somebody no longer in the program, or in it at no level
 * (a visitor on exchange), go to a "No level" entry, shown only when it holds
 * something — leaving them out would make the levels add up to less than the
 * program.
 */
export async function instituteAnalyticsData(programId: string): Promise<AnalyticsData> {
  const [levels, enrollments, sessions, grants] = await Promise.all([
    prisma.programLevel.findMany({
      where: { programId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.studentEnrollment.findMany({
      where: { programId },
      select: { studentId: true, levelId: true },
    }),
    prisma.session.findMany({
      where: { status: SESSION_STATUS.ACTIVE, programId },
      orderBy: { date: "asc" },
      select: {
        programId: true,
        studentId: true,
        minutes: true,
        date: true,
        withinPlan: true,
        attended: true,
        mentor: {
          select: { id: true, name: true, email: true, avatarUpdatedAt: true },
        },
      },
    }),
    grantsIn([programId]),
  ]);

  const levelOf = new Map(enrollments.map((e) => [e.studentId, e.levelId]));
  const index = new Map(levels.map((l, i) => [l.id, i]));
  const bucketOf = (studentId: string): number => {
    const level = levelOf.get(studentId);
    const at = level ? index.get(level) : undefined;
    return at ?? levels.length;
  };

  const { mentors, rows } = toRows(sessions, (s) => bucketOf(s.studentId));
  const granted = new Array<number>(levels.length + 1).fill(0);
  const forfeited = new Array<number>(levels.length + 1).fill(0);
  for (const g of grants) {
    granted[bucketOf(g.studentId)] += g.minutes;
    forfeited[bucketOf(g.studentId)] += g.forfeited;
  }

  const entries: AnalyticsProgram[] = levels.map((l, i) => ({
    id: l.id,
    name: l.name,
    colorIndex: i,
    archived: false,
    granted: granted[i],
    forfeited: forfeited[i],
  }));
  const none = levels.length;
  const unleveled = rows.some((r) => r[0] === none) || granted[none] > 0;
  if (unleveled) {
    entries.push({
      id: NO_LEVEL_ID,
      name: "No level",
      colorIndex: null,
      archived: false,
      granted: granted[none],
      forfeited: forfeited[none],
    });
  }
  return { programs: entries, mentors, rows };
}
