import "server-only";

import { avatarUrl } from "@/lib/avatar";
import { PROGRAM_STATUS, SESSION_STATUS } from "@/lib/constants";
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
 *   EXTRA      out of plan and attended — delivered, charged to nobody
 *   NO_SHOW    the student did not come — charged, but nothing was delivered
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
  archived: boolean;
  /**
   * Minutes ever granted to the program's students — the stock the delivered
   * hours are read against ("4.4h of the 8h granted"). A stock, not a flow: it
   * does not narrow with the year picker the way the session rows do.
   */
  granted: number;
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
  if (!session.attended) return SESSION_KIND.NO_SHOW;
  return session.withinPlan ? SESSION_KIND.COMPLETED : SESSION_KIND.EXTRA;
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
      select: { id: true, name: true, status: true },
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
    prisma.hourAllocation.groupBy({
      by: ["programId"],
      ...(inScope ? { where: { programId: inScope } } : {}),
      _sum: { minutes: true },
    }),
  ]);

  const programIndex = new Map(programs.map((p, i) => [p.id, i]));
  const granted = new Map(grants.map((g) => [g.programId, g._sum.minutes ?? 0]));
  const { mentors, rows } = toRows(sessions, (s) => programIndex.get(s.programId));

  return {
    programs: programs.map((p) => ({
      id: p.id,
      name: p.name,
      archived: p.status === PROGRAM_STATUS.ARCHIVED,
      granted: granted.get(p.id) ?? 0,
    })),
    mentors,
    rows,
  };
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
    prisma.hourAllocation.groupBy({
      by: ["studentId"],
      where: { programId },
      _sum: { minutes: true },
    }),
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
  for (const g of grants) granted[bucketOf(g.studentId)] += g._sum.minutes ?? 0;

  const entries: AnalyticsProgram[] = levels.map((l, i) => ({
    id: l.id,
    name: l.name,
    archived: false,
    granted: granted[i],
  }));
  const unleveled = rows.some((r) => r[0] === levels.length) || granted[levels.length] > 0;
  if (unleveled) {
    entries.push({ id: NO_LEVEL_ID, name: "No level", archived: false, granted: granted[levels.length] });
  }
  return { programs: entries, mentors, rows };
}
