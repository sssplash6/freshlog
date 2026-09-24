import { prisma } from "@/lib/prisma";
import { CHARGED_SESSION, SESSION_STATUS } from "@/lib/constants";
import { deadlinePassed, soonestExpiry } from "@/lib/deadlines";

/**
 * Derived time values (spec §5): never stored as mutable counters. Every figure
 * below is whole MINUTES.
 *  - allotted  = sum of the student's per-mentor HourAllocation rows
 *  - used      = sum of minutes over the student's CHARGING sessions
 *                (present AND no-show — a no-show still draws the time down)
 *  - missed    = subset of used minutes logged as a no-show (attended = false)
 *  - completed = used − missed (time actually delivered)
 *  - remaining = allotted − used
 *  - extra     = minutes logged OUT of plan: delivered, visible, and charged to
 *                nobody, so they sit outside every total above
 * The same values also exist per mentor: an allocation is drawn down only by
 * that mentor's charging sessions.
 *
 * "Charging" is `chargesAllocation()` in lib/constants.ts — active and in-plan.
 */

export async function completedMinutes(
  studentProfileId: string,
  programId?: string
): Promise<number> {
  const result = await prisma.session.aggregate({
    where: {
      studentId: studentProfileId,
      ...(programId ? { programId } : {}),
      ...CHARGED_SESSION,
    },
    _sum: { minutes: true },
  });
  return result._sum.minutes ?? 0;
}

/**
 * Per-mentor balances for one student, plus overall totals, in minutes.
 *
 * `programIds` is the reader's reach. A student may study in several programs
 * and holds a separate balance in each — separate grants, separate deadlines,
 * separate forfeiture — so an admin of one of them gets that program's ledger
 * and no other, and the student themself (no filter) gets all of it. A row is
 * one (program, mentor) pair, which is what an allocation is.
 */
export async function allocationSummary(
  studentProfileId: string,
  programIds?: readonly string[]
) {
  const inScope = programIds ? { programId: { in: [...programIds] } } : {};
  const [allocations, sessionSums] = await Promise.all([
    prisma.hourAllocation.findMany({
      where: { studentId: studentProfileId, ...inScope },
      include: { mentor: true, program: true },
      orderBy: [{ program: { name: "asc" } }, { createdAt: "asc" }],
    }),
    // Grouped by withinPlan as well as attendance, so one query answers both
    // "what did this draw down?" and "what was given on top?".
    prisma.session.groupBy({
      by: ["programId", "mentorId", "attended", "withinPlan"],
      where: { studentId: studentProfileId, status: SESSION_STATUS.ACTIVE, ...inScope },
      _sum: { minutes: true },
    }),
  ]);

  // Minutes drawn down per (program, mentor) — the key an allocation has —
  // plus the no-show subset and, separately because they move no balance, the
  // out-of-plan minutes. Keying on the mentor alone would let a session logged
  // in one program draw down the grant they hold in another.
  const usedByMentor = new Map<string, number>();
  const missedByMentor = new Map<string, number>();
  const extraByMentor = new Map<string, number>();
  const pair = (programId: string, mentorId: string) => `${programId}:${mentorId}`;
  for (const s of sessionSums) {
    const mins = s._sum.minutes ?? 0;
    const k = pair(s.programId, s.mentorId);
    if (!s.withinPlan) {
      extraByMentor.set(k, (extraByMentor.get(k) ?? 0) + mins);
      continue;
    }
    usedByMentor.set(k, (usedByMentor.get(k) ?? 0) + mins);
    if (!s.attended) {
      missedByMentor.set(k, (missedByMentor.get(k) ?? 0) + mins);
    }
  }

  // Once a deadline passes, the allocation's unused minutes are forfeited: they
  // stop counting toward "remaining" and surface as "expired".
  const now = Date.now();
  const perMentor: {
    mentor: (typeof allocations)[number]["mentor"];
    /** The program the grant was made in — a row is one of these per mentor. */
    program: { id: string; name: string };
    allocated: number;
    completed: number;
    missed: number;
    extra: number;
    remaining: number;
    forfeited: number;
    expired: boolean;
    deadline: Date | null;
    amountPaid: number | null;
  }[] = allocations.map((a) => {
    // The unassigned pool (mentor null) can never have sessions against it —
    // sessions are logged by a mentor — so its used/missed are always 0.
    const k = a.mentorId ? pair(a.programId, a.mentorId) : null;
    const used = (k && usedByMentor.get(k)) || 0;
    const missed = (k && missedByMentor.get(k)) || 0;
    const extra = (k && extraByMentor.get(k)) || 0;
    const expired = deadlinePassed(a.deadline, now);
    const forfeited = expired ? Math.max(0, a.minutes - used) : 0;
    return {
      mentor: a.mentor,
      program: a.program,
      allocated: a.minutes,
      completed: used - missed,
      missed,
      extra,
      // Unused minutes on an expired allocation are gone; only overdraw remains.
      remaining: expired ? Math.min(0, a.minutes - used) : a.minutes - used,
      forfeited,
      expired,
      deadline: a.deadline,
      amountPaid: a.amountPaid,
    };
  });

  // Mentors with sessions but no allocation row of their own. Two ways to get
  // there: a mentor working in the student's program may log without holding a
  // grant (the "Whose hours?" tick decides whether it charges), and an admin may
  // remove an allocation afterwards. Either way those minutes are already
  // counted in the totals below, so the breakdown has to name whose they are —
  // otherwise the student and the admin read an overdraw that no row explains.
  // A derived row, so: nothing allotted, no deadline to be past, and whatever
  // was charged showing as the overdraw it is.
  const granted = new Set(
    allocations.flatMap((a) => (a.mentorId ? [pair(a.programId, a.mentorId)] : []))
  );
  const ungranted = [
    ...new Set(sessionSums.map((s) => pair(s.programId, s.mentorId))),
  ].filter((k) => !granted.has(k));
  if (ungranted.length > 0) {
    const [mentors, programs] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: ungranted.map((k) => k.split(":")[1]) } },
      }),
      prisma.program.findMany({
        where: { id: { in: ungranted.map((k) => k.split(":")[0]) } },
        select: { id: true, name: true },
      }),
    ]);
    const mentorById = new Map(mentors.map((m) => [m.id, m]));
    const programById = new Map(programs.map((p) => [p.id, p]));
    for (const k of ungranted) {
      const [programId, mentorId] = k.split(":");
      const mentor = mentorById.get(mentorId);
      const program = programById.get(programId);
      if (!mentor || !program) continue;
      const used = usedByMentor.get(k) ?? 0;
      const missed = missedByMentor.get(k) ?? 0;
      perMentor.push({
        mentor,
        program,
        allocated: 0,
        completed: used - missed,
        missed,
        extra: extraByMentor.get(k) ?? 0,
        remaining: -used,
        forfeited: 0,
        expired: false,
        deadline: null,
        amountPaid: null,
      });
    }
  }

  const allotted = allocations.reduce((sum, a) => sum + a.minutes, 0);
  // Count every charging session, including any logged by a mentor whose
  // allocation was later removed — the student still used that time.
  const inPlan = sessionSums.filter((s) => s.withinPlan);
  const used = inPlan.reduce((sum, s) => sum + (s._sum.minutes ?? 0), 0);
  const missed = inPlan
    .filter((s) => !s.attended)
    .reduce((sum, s) => sum + (s._sum.minutes ?? 0), 0);
  // Out-of-plan minutes, whatever the attendance: they are a record of work
  // given beyond the allocation, and never touch allotted / used / remaining.
  const extra = sessionSums
    .filter((s) => !s.withinPlan)
    .reduce((sum, s) => sum + (s._sum.minutes ?? 0), 0);
  const forfeited = perMentor.reduce((sum, m) => sum + m.forfeited, 0);
  const paid = allocations.reduce((sum, a) => sum + (a.amountPaid ?? 0), 0);

  return {
    perMentor,
    allotted,
    completed: used - missed,
    missed,
    used,
    extra,
    forfeited,
    paid,
    remaining: allotted - used - forfeited,
    /**
     * The soonest use-by date still ahead, with only the minutes behind IT.
     *
     * Computed here, from the rows, rather than left to each page to assemble
     * out of `remaining` and a date it picked separately — which is how a
     * student holding 2h until the 20th and 43h 30m until 2027 came to be told
     * "45h 30m expires September 20". The two halves of that sentence now
     * arrive as one value that cannot disagree with itself.
     */
    expiring: soonestExpiry(perMentor, new Date(now)),
  };
}

export type AllocationSummary = Awaited<ReturnType<typeof allocationSummary>>;

/**
 * Minutes a student has left with one specific mentor, in one program.
 *
 * The program is part of the question, not context: the same mentor may hold
 * separate time with the same student in two programs, and "how much is left
 * with Aziza?" has two different right answers.
 */
export async function remainingWithMentor(
  studentProfileId: string,
  programId: string,
  mentorId: string
): Promise<number | null> {
  const allocation = await prisma.hourAllocation.findUnique({
    where: {
      studentId_programId_mentorId: {
        studentId: studentProfileId,
        programId,
        mentorId,
      },
    },
  });
  if (!allocation) return null;
  const used = await prisma.session.aggregate({
    where: {
      studentId: studentProfileId,
      programId,
      mentorId,
      ...CHARGED_SESSION,
    },
    _sum: { minutes: true },
  });
  return allocation.minutes - (used._sum.minutes ?? 0);
}

/**
 * One program's — or one cohort's, or the whole platform's — hours, summed
 * across students.
 *
 * There were four copies of this reduce (`admin/page.tsx`, `admin/programs/[id]`
 * and the two program islands the scoped roles had) plus a separate one for
 * money, and they did not agree on what a total IS: two summed four fields, one
 * summed two, and none carried `extra`, `forfeited` or the fields' own
 * relationship. A page showing `allotted` and `completed` but not `forfeited`
 * cannot be read — the difference has to go somewhere, and it went nowhere.
 *
 * Pure, and takes the rows rather than fetching: `studentsWithHours()` has
 * already done the work, and every caller has the rows in hand.
 *
 * @param rows students as `studentsWithHours()` returns them
 */
export function programTotals(rows: readonly StudentHoursRow[]): ProgramTotals {
  const totals: ProgramTotals = {
    students: rows.length,
    allotted: 0,
    completed: 0,
    missed: 0,
    remaining: 0,
    forfeited: 0,
    extra: 0,
    paid: 0,
    overdrawn: 0,
  };
  for (const row of rows) {
    totals.allotted += row.allottedMinutes;
    totals.completed += row.completedMinutes;
    totals.missed += row.missedMinutes;
    totals.remaining += row.remainingMinutes;
    totals.forfeited += row.forfeitedMinutes;
    totals.extra += row.extraMinutes;
    totals.paid += row.amountPaid;
    if (row.remainingMinutes < 0) totals.overdrawn += 1;
  }
  return totals;
}

/** The fields of a `StudentWithHours` that a total is built from. */
export type StudentHoursRow = {
  allottedMinutes: number;
  completedMinutes: number;
  missedMinutes: number;
  remainingMinutes: number;
  forfeitedMinutes: number;
  extraMinutes: number;
  amountPaid: number;
};

export type ProgramTotals = {
  students: number;
  allotted: number;
  /** Time delivered: used minus no-shows. */
  completed: number;
  /** No-show minutes. Charged, and inside `completed`'s complement. */
  missed: number;
  /** `allotted − used − forfeited`. Negative when students are overdrawn. */
  remaining: number;
  /** Unused minutes lost to a passed deadline. */
  forfeited: number;
  /** Out-of-plan minutes: delivered, and outside every figure above. */
  extra: number;
  /** Dollars, for programs that track payment. */
  paid: number;
  /** How many of these students are past their allocation. */
  overdrawn: number;
};
