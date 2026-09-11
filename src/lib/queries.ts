import "server-only";

import { soonestExpiry } from "@/lib/deadlines";
import { prisma } from "@/lib/prisma";
import {
  ASSIGNMENT_PROGRESS,
  CHARGED_SESSION,
  SESSION_STATUS,
  USER_STATUS,
} from "@/lib/constants";
import { formatDate, formatDuration } from "@/lib/format";
import { deadlinePassed } from "@/lib/deadlines";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Students with their derived hour totals, in one round trip per collection
 * (profiles + grouped sums over allocations and ACTIVE sessions), not one
 * query per student. allottedMinutes = sum of the student's per-mentor
 * allocations.
 *
 * `slice` narrows it to one page. The derived totals are then computed for that
 * page only — which is the point: the grouped sums are keyed by the ids that
 * came back, so a page of twenty-five students costs the same three queries
 * whether the school has thirty students or three thousand.
 *
 * SCOPE. A student may be enrolled in several programs, and the hours they hold
 * in one are not the hours they hold in another. `programIds` is the reader's
 * reach, and it does two things that have to happen together: the totals are
 * summed over those programs only, and the `enrollments` that come back are
 * narrowed to them too. An admin of the Master's Program reading a student who
 * is also in Global Admissions must not get Global Admissions' minutes in the
 * figure OR its name in the cell — and one of those without the other is the
 * more confusing half of a leak. `undefined` means every program, matching
 * `FilterScope.programIds`.
 *
 * Every figure also comes back per program in `byProgram`, because the pages
 * that print a program's total and the pages that print a student's are the
 * same pages, and two queries would be two chances to disagree.
 */
export async function studentsWithHours(
  where: Prisma.StudentProfileWhereInput = {},
  {
    slice,
    /**
     * The instant forfeiture is judged against.
     *
     * A parameter rather than a call to the clock, so a page that hands one
     * `now` to every component cannot get a different answer from its own
     * query — the impurity `status.ts` exists to remove, and the reason the
     * HoursRing and the ledger once disagreed by 4h 38m. Defaulted, because
     * every existing caller means "right now".
     */
    now = new Date(),
    programIds,
    order = "asc",
  }: {
    slice?: { skip: number; take: number };
    now?: Date;
    programIds?: readonly string[];
    /**
     * Which way round the roster reads.
     *
     * A parameter rather than a sort of the returned page, because the page IS
     * a slice: reversing forty rows out of four hundred reverses the wrong
     * forty, and the reader gets the last page's names in the first page's
     * place.
     */
    order?: "asc" | "desc";
  } = {}
) {
  const visible = programIds ? new Set(programIds) : null;
  const profiles = await prisma.studentProfile.findMany({
    where,
    include: {
      user: true,
      enrollments: {
        ...(visible ? { where: { programId: { in: [...visible] } } } : {}),
        include: { program: true, cohort: true },
        orderBy: { program: { name: "asc" } },
      },
    },
    // Ordering by program name is no longer available — a student has several —
    // so the list is alphabetical by person, which is how it is read anyway.
    orderBy: [{ user: { name: order } }, { createdAt: "asc" }],
    ...(slice ?? {}),
  });
  const ids = profiles.map((p) => p.id);
  const inScope = visible ? { programId: { in: [...visible] } } : {};

  const [allocations, sessionSums] = await Promise.all([
    prisma.hourAllocation.findMany({
      where: { studentId: { in: ids }, ...inScope },
      select: {
        studentId: true,
        programId: true,
        mentorId: true,
        minutes: true,
        deadline: true,
        amountPaid: true,
      },
    }),
    prisma.session.groupBy({
      by: ["studentId", "programId", "mentorId", "attended", "withinPlan"],
      where: { status: SESSION_STATUS.ACTIVE, studentId: { in: ids }, ...inScope },
      _sum: { minutes: true },
      // The last time anybody met them. On the list this is the column that
      // answers "who has gone quiet", which no total can: a student can hold
      // plenty of time and not have been seen for six weeks.
      _max: { date: true },
    }),
  ]);

  /** The seven figures, for one student or for one of their programs. */
  type Tally = {
    allottedMinutes: number;
    completedMinutes: number;
    missedMinutes: number;
    extraMinutes: number;
    forfeitedMinutes: number;
    remainingMinutes: number;
    amountPaid: number;
    /**
     * The soonest use-by date still ahead and only the minutes behind it, as
     * one value. It replaced a bare `nextDeadline`, which callers were pairing
     * with `remainingMinutes` — a total across every grant, most of them
     * running years later — and printing as one sentence.
     */
    expiring: { minutes: number; date: Date } | null;
    lastSessionAt: Date | null;
  };
  // Used = every CHARGING session (present + no-show); missed = the no-show
  // subset. usedByAllocation drives per-allocation forfeiture on expired
  // deadlines, and its key is (student, program, mentor) because that is what
  // an allocation IS: the same mentor may hold separate time with the same
  // student in two programs, and one key for both would forfeit against a
  // balance the hours never came out of.
  const used = new Map<string, number>();
  const missed = new Map<string, number>();
  const extra = new Map<string, number>();
  const lastSession = new Map<string, Date>();
  const usedByAllocation = new Map<string, number>();
  /** Per student, and per (student, program) under the same accumulators. */
  const keys = (s: { studentId: string; programId: string }) => [
    s.studentId,
    `${s.studentId}:${s.programId}`,
  ];
  const add = (map: Map<string, number>, key: string, n: number) =>
    map.set(key, (map.get(key) ?? 0) + n);
  for (const s of sessionSums) {
    const at = s._max.date;
    if (at) {
      for (const k of keys(s)) {
        const seen = lastSession.get(k);
        if (!seen || at > seen) lastSession.set(k, at);
      }
    }
    const mins = s._sum.minutes ?? 0;
    if (!s.withinPlan) {
      for (const k of keys(s)) add(extra, k, mins);
      continue;
    }
    for (const k of keys(s)) add(used, k, mins);
    add(usedByAllocation, `${s.studentId}:${s.programId}:${s.mentorId}`, mins);
    if (!s.attended) for (const k of keys(s)) add(missed, k, mins);
  }

  // allotted per student and per program, plus the minutes forfeited by
  // allocations whose deadline has passed.
  const allotted = new Map<string, number>();
  const forfeited = new Map<string, number>();
  const paid = new Map<string, number>();
  // Every grant that can still expire, per key, so `soonestExpiry` can pair
  // the soonest DATE with the minutes actually behind it. Collected rather
  // than reduced on the fly: the soonest date is not known until every grant
  // has been seen, and the minutes wanted are only the ones on that date.
  const live = new Map<string, { remaining: number; deadline: Date | null }[]>();
  const at = now.getTime();
  for (const a of allocations) {
    for (const k of keys(a)) {
      add(allotted, k, a.minutes);
      if (a.amountPaid != null) add(paid, k, a.amountPaid);
    }
    const drawn =
      usedByAllocation.get(`${a.studentId}:${a.programId}:${a.mentorId}`) ?? 0;
    if (a.deadline.getTime() < at) {
      const lost = Math.max(0, a.minutes - drawn);
      if (lost > 0) for (const k of keys(a)) add(forfeited, k, lost);
    } else {
      for (const k of keys(a)) {
        const rows = live.get(k) ?? [];
        rows.push({ remaining: a.minutes - drawn, deadline: a.deadline });
        live.set(k, rows);
      }
    }
  }

  const tally = (key: string): Tally => {
    const allottedMinutes = allotted.get(key) ?? 0;
    const drawn = used.get(key) ?? 0;
    const missedMinutes = missed.get(key) ?? 0;
    const forfeitedMinutes = forfeited.get(key) ?? 0;
    return {
      allottedMinutes,
      completedMinutes: drawn - missedMinutes,
      missedMinutes,
      extraMinutes: extra.get(key) ?? 0,
      forfeitedMinutes,
      remainingMinutes: allottedMinutes - drawn - forfeitedMinutes,
      amountPaid: paid.get(key) ?? 0,
      expiring: soonestExpiry(live.get(key) ?? [], now),
      lastSessionAt: lastSession.get(key) ?? null,
    };
  };

  return profiles.map((profile) => ({
    ...profile,
    ...tally(profile.id),
    /**
     * The same figures, program by program — what a program's page totals and
     * what the inbox tags a flag with. Only the programs the reader may see,
     * since `enrollments` was narrowed to those before anything was summed.
     */
    byProgram: new Map(
      profile.enrollments.map((e) => [
        e.programId,
        {
          programId: e.programId,
          program: e.program,
          cohort: e.cohort,
          ...tally(`${profile.id}:${e.programId}`),
        },
      ])
    ),
  }));
}

/** One student's figures inside one of their programs. */
export type StudentProgramHours = Awaited<
  ReturnType<typeof studentsWithHours>
>[number]["byProgram"] extends Map<string, infer V>
  ? V
  : never;

export type StudentWithHours = Awaited<
  ReturnType<typeof studentsWithHours>
>[number];

/**
 * The two halves of one student's ledger: the meetings log (every mentor's
 * sessions, newest first) and the assignment plan (in its own order). Everyone
 * who can see the student sees the whole log, not just their own slice — the
 * spreadsheet this replaces was shared, and a mentor picking up an essay needs
 * to know what the last three meetings covered.
 */
export async function studentLedger(
  studentProfileId: string,
  /** The reader's programs. `undefined` is every one the student is in. */
  programIds?: readonly string[]
) {
  const inScope = programIds ? { programId: { in: [...programIds] } } : {};
  const [sessions, assignments] = await Promise.all([
    prisma.session.findMany({
      where: { studentId: studentProfileId, ...inScope },
      include: {
        mentor: true,
        program: true,
        assignment: { select: { id: true, purpose: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    prisma.assignment.findMany({
      where: { studentId: studentProfileId, ...inScope },
      include: { mentor: true, program: true },
      orderBy: { position: "asc" },
    }),
  ]);

  // Hours actually delivered against each goal, so a plan can be read against
  // reality. ACTIVE only: voided sessions returned their time. Out-of-plan
  // hours DO count here — a task's hour limit budgets the work, and work done
  // for free is still work done on the essay.
  const loggedByGoal = new Map<string, number>();
  for (const session of sessions) {
    if (!session.assignmentId || session.status !== SESSION_STATUS.ACTIVE) continue;
    loggedByGoal.set(
      session.assignmentId,
      (loggedByGoal.get(session.assignmentId) ?? 0) + session.minutes
    );
  }

  return {
    sessions,
    assignments: assignments.map((a) => ({
      ...a,
      loggedMinutes: loggedByGoal.get(a.id) ?? 0,
    })),
  };
}

export type LedgerSession = Awaited<
  ReturnType<typeof studentLedger>
>["sessions"][number];

/**
 * One student's scheduled meetings, whoever booked them, newest date first.
 * Everyone who can see the student sees all of them — the same reasoning as the
 * meetings log: a mentor picking up an essay should know the student already
 * has a mock interview on Thursday with someone else.
 *
 * Callers bucket these with `splitMeetings` (lib/interviews.ts) rather than
 * filtering by date here, so "upcoming" means the same thing on every page.
 */
export async function studentMeetings(studentProfileId: string) {
  return prisma.interview.findMany({
    where: { studentId: studentProfileId },
    include: { mentor: true },
    orderBy: { scheduledAt: "desc" },
  });
}

export type StudentMeeting = Awaited<
  ReturnType<typeof studentMeetings>
>[number];

/**
 * A mentor's own diary: every meeting they have on the books, with the student
 * on it. Not date-filtered for the same reason as `studentMeetings` — the
 * overdue ones are exactly what a mentor's dashboard needs to surface.
 */
export async function mentorMeetings(mentorId: string) {
  return prisma.interview.findMany({
    where: { mentorId },
    include: { mentor: true, student: { include: { user: true } } },
    orderBy: { scheduledAt: "desc" },
  });
}

export type MentorMeeting = Awaited<ReturnType<typeof mentorMeetings>>[number];

/**
 * The most recent meetings across students, for the log that leads a dashboard.
 * Scoped to one mentor when given, otherwise every program's sessions.
 */
export async function recentMeetings({
  mentorId,
  programId,
  programIds,
  take = 8,
}: {
  mentorId?: string;
  programId?: string;
  /** A reader's whole scope. `undefined` is every program, not none. */
  programIds?: readonly string[];
  take?: number;
} = {}) {
    return prisma.session.findMany({
    where: {
      ...(mentorId ? { mentorId } : {}),
      // The session's OWN program, not its student's: a student may be in two,
      // and "sessions in this program" has to mean the meetings that drew this
      // program's hours down rather than every meeting that person ever had.
      ...(programId
        ? { programId }
        : programIds
          ? { programId: { in: [...programIds] } }
          : {}),
    },
        include: {
      mentor: true,
      // The program comes along because a one-line session row names it —
      // "Malika logged 90 min with Aziza · Master's Program" — and looking it
      // up separately meant a second query for a string already one join away.
      program: true,
      student: { include: { user: true } },
      assignment: { select: { id: true, purpose: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take,
  });
}

export type LedgerAssignment = Awaited<
  ReturnType<typeof studentLedger>
>["assignments"][number];

/**
 * Every task in a program with the hours logged against it — the program's work
 * in flight. Unfinished tasks come first, then the sheet's own order, so a
 * dashboard can show what is outstanding without filtering client-side.
 */
export async function programTasks(programId: string) {
  const tasks = await prisma.assignment.findMany({
    where: { programId },
    include: {
      mentor: true,
      student: { include: { user: true } },
    },
    orderBy: [{ studentId: "asc" }, { position: "asc" }],
  });
  if (tasks.length === 0) return [];

  const logged = await prisma.session.groupBy({
    by: ["assignmentId"],
    where: {
      status: SESSION_STATUS.ACTIVE,
      assignmentId: { in: tasks.map((t) => t.id) },
    },
    _sum: { minutes: true },
  });
  const loggedById = new Map(
    logged.map((l) => [l.assignmentId ?? "", l._sum.minutes ?? 0])
  );

  return tasks
    .map((task) => ({ ...task, loggedMinutes: loggedById.get(task.id) ?? 0 }))
    .sort((a, b) => {
      // Stable sort, so unfinished work floats up and each student's own order
      // survives underneath.
      const aDone = a.progress === ASSIGNMENT_PROGRESS.DONE ? 1 : 0;
      const bDone = b.progress === ASSIGNMENT_PROGRESS.DONE ? 1 : 0;
      return aDone - bDone;
    });
}

export type ProgramTask = Awaited<ReturnType<typeof programTasks>>[number];

/**
 * The tasks each logged session could be attached to: the ones its own mentor
 * holds for its own student. Keyed by session id, because a log can span
 * students and mentors — the dashboard's does — and a correction menu needs the
 * right handful, not all of them.
 *
 * One query for the whole log, not one per row.
 */
export async function taskOptionsForSessions(
  sessions: { id: string; studentId: string; programId: string; mentorId: string }[]
): Promise<Record<string, { value: string; label: string }[]>> {
  if (sessions.length === 0) return {};

  const tasks = await prisma.assignment.findMany({
    where: { studentId: { in: [...new Set(sessions.map((s) => s.studentId))] } },
    orderBy: { position: "asc" },
    select: {
      id: true,
      studentId: true,
      programId: true,
      mentorId: true,
      purpose: true,
      progress: true,
    },
  });

  // Keyed with the program, because `resolveGoal` refuses a task from another
  // one: offering it here would be offering a correction the action will then
  // turn down.
  const byPair = new Map<string, { value: string; label: string }[]>();
  for (const task of tasks) {
    const key = `${task.studentId}:${task.programId}:${task.mentorId}`;
    const list = byPair.get(key) ?? [];
    // Done tasks stay pickable: a session may be the last one against work an
    // admin has already ticked off, and hiding it would strand the correction.
    list.push({
      value: task.id,
      label:
        task.progress === ASSIGNMENT_PROGRESS.DONE
          ? `${task.purpose} (done)`
          : task.purpose,
    });
    byPair.set(key, list);
  }

  const bySession: Record<string, { value: string; label: string }[]> = {};
  for (const session of sessions) {
    const list = byPair.get(
      `${session.studentId}:${session.programId}:${session.mentorId}`
    );
    if (list) bySession[session.id] = list;
  }
  return bySession;
}

/**
 * The programs (and, for Global Admissions, cohorts) a mentor is assigned
 * to, with booking links. cohort is null for program-wide assignments.
 */
export async function mentorAssignments(mentorId: string) {
  return prisma.mentorAssignment.findMany({
    where: { mentorId },
    include: { program: true, cohort: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Every program a mentor touches: assigned to, holding hours in, or having
 * logged a session in. Assignment alone isn't enough — a mentor moved off a
 * program still has its history — so the filter offers all three.
 */
export async function mentorPrograms(mentorId: string) {
  return prisma.program.findMany({
    where: {
      OR: [
        { mentorAssignments: { some: { mentorId } } },
        { hourAllocations: { some: { mentorId } } },
        { sessions: { some: { mentorId } } },
      ],
    },
    orderBy: { name: "asc" },
  });
}

/** How a mentor's hours are being read: which program, and over what dates. */
export type MentorHoursWindow = {
  programId?: string;
  from?: Date;
  to?: Date;
};

/**
 * One mentor's whole picture for the admin's mentor page: the students holding
 * hours from them, the sessions inside the chosen window, and both rolled up
 * per program.
 *
 * Two kinds of number live here and the difference is deliberate. BALANCES
 * (allocated, remaining, forfeited) weigh allocations against every active
 * session ever logged — a balance has no date range. DELIVERED and MISSED are
 * hours inside the window. The program filter narrows both halves; the dates
 * only move the window, which is why the page labels the two apart.
 */
export async function mentorOverview(
  mentorId: string,
  { programId, from, to }: MentorHoursWindow = {}
) {
  // The row's own program — an allocation and a session each name one now, so
  // neither has to be reached through the student, who may be in several.
  const inProgram = programId ? { programId } : {};
  const inWindow =
    from || to
      ? {
          date: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {};

  const [allocations, lifetimeSums, sessions] = await Promise.all([
    prisma.hourAllocation.findMany({
      where: { mentorId, ...inProgram },
      include: {
        program: true,
        student: { include: { user: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    // Balances draw on every charging session this mentor ever logged, not just
    // the ones the window happens to show. Grouped by program as well as
    // student, because an allocation is per (student, program, mentor) and a
    // balance summed across a student's programs would draw one program's
    // hours out of another's grant.
    prisma.session.groupBy({
      by: ["studentId", "programId", "attended"],
      where: { mentorId, ...CHARGED_SESSION },
      _sum: { minutes: true },
    }),
    prisma.session.findMany({
      where: { mentorId, ...inProgram, ...inWindow },
      include: {
        mentor: true,
        program: true,
        student: { include: { user: true } },
        assignment: { select: { id: true, purpose: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  const usedByGrant = new Map<string, number>();
  const missedByGrant = new Map<string, number>();
  const grantKey = (s: { studentId: string; programId: string }) =>
    `${s.studentId}:${s.programId}`;
  for (const s of lifetimeSums) {
    const hrs = s._sum.minutes ?? 0;
    const key = grantKey(s);
    usedByGrant.set(key, (usedByGrant.get(key) ?? 0) + hrs);
    if (!s.attended) {
      missedByGrant.set(key, (missedByGrant.get(key) ?? 0) + hrs);
    }
  }

  // Same forfeiture rule as lib/hours.ts: once the use-by date passes, unused
  // hours are gone and only an overdraw survives as "remaining".
  const students = allocations.map((a) => {
    const used = usedByGrant.get(grantKey(a)) ?? 0;
    const missed = missedByGrant.get(grantKey(a)) ?? 0;
    const expired = deadlinePassed(a.deadline);
    return {
      student: a.student,
      program: a.program,
      allocated: a.minutes,
      used,
      completed: used - missed,
      missed,
      remaining: expired ? Math.min(0, a.minutes - used) : a.minutes - used,
      forfeited: expired ? Math.max(0, a.minutes - used) : 0,
      expired,
      deadline: a.deadline,
      amountPaid: a.amountPaid,
    };
  });

  const active = sessions.filter((s) => s.status === SESSION_STATUS.ACTIVE);

  type ProgramRow = {
    id: string;
    name: string;
    students: number;
    allocated: number;
    used: number;
    forfeited: number;
    remaining: number;
    delivered: number;
    missed: number;
    /** Hours given out of plan in the window — delivered, but charged to nobody. */
    extra: number;
    sessions: number;
  };
  const rows = new Map<string, ProgramRow>();
  const rowFor = (id: string, name: string) => {
    const existing = rows.get(id);
    if (existing) return existing;
    const fresh: ProgramRow = {
      id,
      name,
      students: 0,
      allocated: 0,
      used: 0,
      forfeited: 0,
      remaining: 0,
      delivered: 0,
      missed: 0,
      extra: 0,
      sessions: 0,
    };
    rows.set(id, fresh);
    return fresh;
  };
  for (const s of students) {
    const row = rowFor(s.program.id, s.program.name);
    row.students += 1;
    row.allocated += s.allocated;
    row.used += s.used;
    row.forfeited += s.forfeited;
    row.remaining += s.remaining;
  }
  // A session can outlive its allocation (an admin may remove one), so the
  // window's hours land in their program's row either way.
  for (const s of active) {
    const row = rowFor(s.programId, s.program.name);
    row.sessions += 1;
    if (!s.withinPlan) row.extra += s.minutes;
    else if (s.attended) row.delivered += s.minutes;
    else row.missed += s.minutes;
  }

  const sum = (pick: (row: ProgramRow) => number) =>
    [...rows.values()].reduce((total, row) => total + pick(row), 0);

  return {
    students,
    sessions,
    byProgram: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)),
    totals: {
      // Grants, not people: a student holding time from this mentor in two
      // programs is two balances to read, and the rows below are one each.
      students: new Set(students.map((s) => s.student.id)).size,
      sessions: active.length,
      delivered: sum((r) => r.delivered),
      missed: sum((r) => r.missed),
      extra: sum((r) => r.extra),
      allocated: sum((r) => r.allocated),
      forfeited: sum((r) => r.forfeited),
      remaining: sum((r) => r.remaining),
    },
  };
}

export type MentorOverview = Awaited<ReturnType<typeof mentorOverview>>;

/**
 * The distinct mentors working in a program (assigned program-wide or to any
 * of its cohorts) — the pool an admin may allocate a student's time from.
 */
export async function mentorsInProgram(programId: string) {
  const assignments = await prisma.mentorAssignment.findMany({
    where: { programId },
    include: { mentor: true },
    orderBy: { createdAt: "asc" },
  });
  const seen = new Set<string>();
  return assignments
    .map((a) => a.mentor)
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

/**
 * The mentor assignments visible to one student: in EACH program they are
 * enrolled in, the program-wide pairings plus that enrollment's own cohort.
 *
 * One clause per enrollment rather than one clause with a list of programs,
 * because the cohort belongs to a particular enrollment: a student in Global
 * Admissions / Spring 25 and in the Master's Program may see Spring 25's
 * mentors and the Master's Program's program-wide ones, and never Autumn 25's.
 * A flattened `programId in (…) AND cohortId in (…)` says the wrong thing the
 * moment two programs both have cohorts.
 *
 * A student enrolled in nothing matches nothing — `OR: []` is false in Prisma,
 * which is the honest answer rather than every mentor in the school.
 */
export function assignmentsForStudentWhere(profile: {
  enrollments: readonly { programId: string; cohortId: string | null }[];
}): Prisma.MentorAssignmentWhereInput {
  return {
    OR: profile.enrollments.map((e) => ({
      programId: e.programId,
      OR: [{ cohortId: null }, ...(e.cohortId ? [{ cohortId: e.cohortId }] : [])],
    })),
  };
}

/**
 * All programs with their cohorts, for enrollment/assignment selects. Only
 * programs with cohorts (Global Admissions) require picking one.
 */
export async function programOptions(
  programIds?: readonly string[],
  /** Archived programs, for a page that is ABOUT them rather than picking one. */
  includeArchived = false
) {
  return prisma.program.findMany({
    where: {
      ...(programIds ? { id: { in: [...programIds] } } : {}),
      // An archived program is one nothing new should be enrolled into. It
      // keeps its students, its ledger and its pages; it just stops being
      // offered. That is the whole difference between archiving and deleting.
      ...(includeArchived ? {} : { status: "ACTIVE" }),
    },
    include: { cohorts: { orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });
}

/** Shape passed to the client-side enrollment forms. */
export type ProgramOption = {
  id: string;
  name: string;
  cohorts: { id: string; name: string }[];
};

export function toProgramOptions(
  programs: Awaited<ReturnType<typeof programOptions>>
): ProgramOption[] {
  return programs.map((p) => ({
    id: p.id,
    name: p.name,
    cohorts: p.cohorts.map((c) => ({ id: c.id, name: c.name })),
  }));
}

/**
 * One mentor's caseload — the answer to "who are my students?", once.
 *
 * The rule was written four times, in four shapes, in four files
 * (`interviews.ts:46-74`, `sessions.ts:229-275`, `mentor/students/[id]`,
 * `admin/students/[id]`), and a fifth copy — 250 lines of it — lived inside the
 * `/mentor` page component, which is why `/sessions/new` could not exist: the
 * only place that knew which students a mentor may log for was a page body.
 *
 * A mentor REACHES a student five ways, and each is here for a reason:
 *
 *   allocation   an admin granted this mentor time with them. This alone is
 *                authorization, and it outlives a program assignment that later
 *                moves, so hours already delivered can always be corrected.
 *   pool         the student holds unassigned time in a program this mentor
 *                works in. Logging is what decides whose time it was.
 *   ever met     a logged session, even with no allocation — a grant may be
 *                removed after the fact, and the meeting still happened.
 *   task         an admin put this student's work on this mentor's list. Hours
 *                and tasks are separate rows and a task can be MOVED between
 *                mentors on its own (lib/actions/assignments.ts) while the
 *                hours stay banked with whoever they were granted to — so this
 *                is a mentor's student by the only measure that matters to
 *                them, the work, and the missing hours are a row that SAYS so
 *                ("No time with you") rather than an absence.
 *   in program   everyone else enrolled in a program this mentor is assigned
 *                to. Not their student, and in no total, but fully loggable:
 *                a mentor who works in a program may log hours with anyone in
 *                it, whether or not a grant was ever made for them.
 *
 * The first four groups are `students` — the caseload, the people a mentor
 * holds a balance or a piece of work for. The fifth is `loggable`, which is
 * everyone else in their programs. Both come back so a caller can decide which
 * it needs: `/mentor` lists the caseload, and the log picker offers the union,
 * because a mentor may log hours with anybody in a program they work in.
 */
/** One of a mentor's pairings, as the students it lets them reach. */
export type MentorPairing = { programId: string; cohortId: string | null };

/**
 * The five legs above, as one `where` — so "who are my students?" and "is this
 * one of mine?" cannot drift apart. A list that offers a student and a page
 * that 404s on them is the same bug twice, and it was live for months.
 *
 * Pure and synchronous. The first four legs need nothing but the mentor's id.
 * The fifth — everyone in their programs — is a relation the database can walk
 * on its own, so it needs no pairings either: pass `includeProgram` and the
 * `where` asks "is this student enrolled in a program this mentor is assigned
 * to?" in the query rather than in a list somebody fetched first.
 *
 * `pairings` therefore only feeds the pool leg, and only for the caseload
 * lists that build one from the program lens the reader chose. Pass none and
 * that leg is absent — which is right for "students of mine", and wrong for
 * "students I may log against", hence `includeProgram`.
 */
export function mentorReachWhere(
  mentorId: string,
  opts: {
    pairings?: readonly MentorPairing[];
    /** Add the fifth leg: everyone in a program this mentor works in. */
    includeProgram?: boolean;
  } = {}
): Prisma.StudentProfileWhereInput {
  const reach: Prisma.StudentProfileWhereInput[] = [
    // An admin granted this mentor time with them.
    { hourAllocations: { some: { mentorId } } },
    // They have met: a grant can be removed, a session happened.
    { sessions: { some: { mentorId } } },
    // An admin put this student's work on this mentor's list.
    { assignments: { some: { mentorId } } },
  ];

  const pairings = opts.pairings;
  if (pairings && pairings.length > 0) {
    // A pairing is program-wide (cohortId null) or to one cohort inside it,
    // and a student is reached by whichever of the two the pairing says —
    // asked of their ENROLLMENTS, since a student may be in several programs
    // and only one of them need be this mentor's.
    const inPairings: Prisma.StudentProfileWhereInput = {
      enrollments: {
        some: {
          OR: pairings.map((p) =>
            p.cohortId
              ? { programId: p.programId, cohortId: p.cohortId }
              : { programId: p.programId }
          ),
        },
      },
    };
    // Unassigned time in one of those programs: logging is the act that
    // decides whose time it was. The pool has to be in the SAME program as the
    // pairing — a mentor working in Global Admissions must not be able to log
    // against a pool the student holds in the Master's Program.
    reach.push({
      AND: [
        inPairings,
        {
          hourAllocations: {
            some: {
              mentorId: null,
              programId: { in: pairings.map((p) => p.programId) },
            },
          },
        },
      ],
    });
  }

  /**
   * Everyone enrolled in a program this mentor is assigned to — the whole
   * program, cohort and all.
   *
   * Asked of the ASSIGNMENT rather than of a pairing list the caller passed,
   * for two reasons. It works without one, so every gate can ask it — the
   * roster's `where`, the log action, a student's own page — and they cannot
   * answer differently. And it is deliberately program-wide: a mentor who
   * works in a program may log hours with any student in that program, so a
   * pairing scoped to one cohort still reaches the program it is inside.
   * Narrowing here was how a mentor covering for a colleague ended up asking
   * an admin for a grant before they could record a meeting that had already
   * happened.
   */
  if (opts.includeProgram) {
    reach.push({
      enrollments: {
        some: { program: { mentorAssignments: { some: { mentorId } } } },
      },
    });
  }

  return { OR: reach };
}

/**
 * Which of a student's programs this mentor may log a session into.
 *
 * The same five legs as `mentorReachWhere`, asked for a program rather than a
 * yes/no: a grant here, a pool here they may claim, a meeting already logged
 * here, a task on their list here, or simply an assignment to a program the
 * student is enrolled in. `mentorReaches` says whether they may log at all;
 * this says where the hours would come from, and the two agree by construction
 * because they are the same five facts.
 *
 * Ordered with the programs that hold live time first, so a form that must pick
 * a default picks the useful one.
 */
export async function reachablePrograms(
  mentorId: string,
  profile: {
    id: string;
    enrollments: readonly {
      programId: string;
      cohortId: string | null;
      program: { id: string; name: string };
    }[];
  }
): Promise<{ id: string; name: string }[]> {
  const [pairings, allocations, sessions, tasks] = await Promise.all([
    prisma.mentorAssignment.findMany({
      where: { mentorId },
      select: { programId: true, cohortId: true },
    }),
    prisma.hourAllocation.findMany({
      where: { studentId: profile.id, OR: [{ mentorId }, { mentorId: null }] },
      select: { programId: true, mentorId: true },
    }),
    prisma.session.findMany({
      where: { studentId: profile.id, mentorId },
      select: { programId: true },
      distinct: ["programId"],
    }),
    prisma.assignment.findMany({
      where: { studentId: profile.id, mentorId },
      select: { programId: true },
      distinct: ["programId"],
    }),
  ]);

  // Program-level, cohort and all — the same rule `mentorReachWhere`'s fifth
  // leg states. A mentor assigned to a program may log with anybody enrolled
  // in it, so the program is a place their hours can land whether or not the
  // pairing that put them there named a cohort.
  const paired = (e: { programId: string }) =>
    pairings.some((p) => p.programId === e.programId);
  const granted = new Set(
    allocations.filter((a) => a.mentorId === mentorId).map((a) => a.programId)
  );
  const pooled = new Set(
    allocations.filter((a) => a.mentorId === null).map((a) => a.programId)
  );
  const met = new Set(sessions.map((x) => x.programId));
  const tasked = new Set(tasks.map((x) => x.programId));

  return profile.enrollments
    .filter(
      (e) =>
        granted.has(e.programId) ||
        met.has(e.programId) ||
        tasked.has(e.programId) ||
        // The pool leg and the plain in-program leg are the same condition
        // here: both need an assignment to the program this enrollment is in.
        paired(e)
    )
    .map((e) => ({
      id: e.program.id,
      name: e.program.name,
      live: granted.has(e.programId) || pooled.has(e.programId) ? 0 : 1,
    }))
    .sort((a, b) => a.live - b.live || a.name.localeCompare(b.name))
    .map(({ id, name }) => ({ id, name }));
}

export type CaseloadStudent = {
  profile: {
    id: string;
    telegramUsername: string | null;
    folderUrl: string | null;
    user: { name: string | null; email: string; status: string };
    enrollments: {
      programId: string;
      cohortId: string | null;
      program: { name: string };
      cohort: { name: string } | null;
    }[];
  };
  /**
   * WHICH program this row is about. A caseload row is a balance, and a
   * balance belongs to one program: a student a mentor holds time with in two
   * programs is two rows, with two deadlines, because that is two questions
   * ("how much is left in the Master's Program?") with two answers.
   */
  program: { id: string; name: string };
  allocated: number;
  completed: number;
  missed: number;
  /** Delivered on top of the plan: outside every total, but real work. */
  extra: number;
  remaining: number;
  deadline: Date | null;
  expired: boolean;
  approved: boolean;
  /** Unassigned hours this student holds; only when the mentor has no grant. */
  pool?: number;
  /** How this mentor reaches them, for a list that sorts by closeness. */
  reach: "allocation" | "pool" | "met" | "task";
};

export type MentorCaseload = {
  students: CaseloadStudent[];
  /** In the mentor's programs, but not theirs: pickable, never totalled. */
  loggable: {
    id: string;
    /** The programs of theirs this mentor works in — where a log may land. */
    programs: { id: string; name: string }[];
    user: { name: string | null; email: string };
  }[];
  /** studentId → the tasks this mentor may log against for them. */
  goalsByStudent: Map<string, { value: string; label: string }[]>;
  assignments: Awaited<ReturnType<typeof mentorAssignments>>;
  /** Lifetime figures for this mentor, across every program. */
  delivered: { minutes: number; missed: number; extra: number; sessions: number };
};

export async function mentorCaseload(mentorId: string): Promise<MentorCaseload> {
  const [assignments, allocations, poolAllocations, mySessionSums, lifetime, myGoals] =
    await Promise.all([
      mentorAssignments(mentorId),
      prisma.hourAllocation.findMany({
        where: { mentorId },
        include: { program: true, student: { include: { user: true, enrollments: { include: { program: true, cohort: true } } } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.hourAllocation.findMany({
        where: { mentorId: null },
        include: { program: true, student: { include: { user: true, enrollments: { include: { program: true, cohort: true } } } } },
        orderBy: { createdAt: "asc" },
      }),
      // Split by plan: in-plan rows are the balances (out-of-plan hours never
      // shrink what a student holds), and the whole set names everyone this
      // mentor has met — including students they only ever gave extra time to.
      // Grouped by program too, since a balance is per (student, program).
      prisma.session.groupBy({
        by: ["studentId", "programId", "attended", "withinPlan"],
        where: { mentorId, status: SESSION_STATUS.ACTIVE },
        _sum: { minutes: true },
      }),
      prisma.session.groupBy({
        by: ["attended", "withinPlan"],
        where: { mentorId, status: SESSION_STATUS.ACTIVE },
        _sum: { minutes: true },
        _count: true,
      }),
      // Tasks an admin gave THIS mentor, plus tasks with no mentor yet —
      // logging against an unassigned one is how it becomes theirs.
      prisma.assignment.findMany({
        where: { OR: [{ mentorId }, { mentorId: null }] },
        orderBy: [{ studentId: "asc" }, { position: "asc" }],
        select: {
          id: true,
          studentId: true,
          programId: true,
          mentorId: true,
          purpose: true,
          progress: true,
        },
      }),
    ]);

  // Keyed by (student, program): a task belongs to one program's plan, and
  // offering the Master's Program's essay against a Global Admissions session
  // would attach delivered hours to work in a program that never ordered it.
  const goalsByStudent = new Map<string, { value: string; label: string }[]>();
  for (const g of myGoals) {
    const key = `${g.studentId}:${g.programId}`;
    const list = goalsByStudent.get(key) ?? [];
    // Done tasks stay pickable: a mentor may log a final session for work an
    // admin already ticked off, and hiding it would strand those hours.
    list.push({
      value: g.id,
      label:
        g.progress === ASSIGNMENT_PROGRESS.DONE
          ? `${g.purpose} (done)`
          : g.mentorId === null
            ? `${g.purpose} (unassigned)`
            : g.purpose,
    });
    goalsByStudent.set(key, list);
  }

  // Keyed by (student, program) — the shape of an allocation, and so the shape
  // of a balance. A key of student alone would spend one program's minutes out
  // of another program's grant.
  const used = new Map<string, number>();
  const missedBy = new Map<string, number>();
  const extraBy = new Map<string, number>();
  const key = (s: { studentId: string; programId: string }) =>
    `${s.studentId}:${s.programId}`;
  for (const s of mySessionSums) {
    const minutes = s._sum.minutes ?? 0;
    const k = key(s);
    if (!s.withinPlan) {
      extraBy.set(k, (extraBy.get(k) ?? 0) + minutes);
      continue;
    }
    used.set(k, (used.get(k) ?? 0) + minutes);
    if (!s.attended) missedBy.set(k, (missedBy.get(k) ?? 0) + minutes);
  }

  const students: CaseloadStudent[] = allocations.map((a) => {
    const drawn = used.get(key(a)) ?? 0;
    const missed = missedBy.get(key(a)) ?? 0;
    const expired = deadlinePassed(a.deadline);
    return {
      profile: a.student,
      program: a.program,
      allocated: a.minutes,
      completed: drawn - missed,
      missed,
      extra: extraBy.get(key(a)) ?? 0,
      // Unused hours on an expired allocation are forfeited.
      remaining: expired ? Math.min(0, a.minutes - drawn) : a.minutes - drawn,
      deadline: a.deadline,
      expired,
      approved: a.student.user.status === USER_STATUS.ACTIVE,
      reach: "allocation",
    };
  });

  /**
   * Is this mentor assigned to the program this pool of hours sits in, and is
   * the student actually enrolled there?
   *
   * Program-level on both halves, matching `mentorReachWhere`'s fifth leg: the
   * mentor may log with anybody in a program they work in, so the pool of a
   * student in that program is theirs to claim regardless of which cohort
   * either row names.
   */
  const inScope = (
    student: { enrollments: readonly { programId: string }[] },
    programId: string
  ) =>
    student.enrollments.some((e) => e.programId === programId) &&
    assignments.some((a) => a.programId === programId);

  // Skipped once the mentor holds their own grant IN THAT PROGRAM (that row
  // already exists, and their sessions draw their own hours), and once the pool
  // is empty or expired — there is nothing left to log against.
  const mine = new Set(allocations.map((a) => key(a)));
  for (const p of poolAllocations) {
    if (mine.has(key(p))) continue;
    if (p.minutes <= 0 || deadlinePassed(p.deadline)) continue;
    if (!inScope(p.student, p.programId)) continue;
    students.push({
      profile: p.student,
      program: p.program,
      allocated: 0,
      completed: 0,
      missed: 0,
      extra: extraBy.get(key(p)) ?? 0,
      remaining: 0,
      deadline: p.deadline,
      expired: false,
      approved: p.student.user.status === USER_STATUS.ACTIVE,
      pool: p.minutes,
      reach: "pool",
    });
  }

  // A row is one (student, program) pair from here on: the same person can be
  // a granted balance in one program and a bare "we have met" in another.
  const listed = new Set(students.map((s) => `${s.profile.id}:${s.program.id}`));
  /** Fetch the profiles behind a set of (student, program) keys, once. */
  const profilesFor = async (pairs: readonly string[]) => {
    const ids = [...new Set(pairs.map((k) => k.split(":")[0]))];
    if (ids.length === 0) return new Map<string, CaseloadStudent["profile"]>();
    const rows = await prisma.studentProfile.findMany({
      where: { id: { in: ids } },
      include: { user: true, enrollments: { include: { program: true, cohort: true } } },
    });
    return new Map(rows.map((r) => [r.id, r]));
  };
  const programName = new Map<string, string>();
  for (const a of [...allocations, ...poolAllocations]) {
    programName.set(a.programId, a.program.name);
  }
  /** A program's row, fetched only for the ids no allocation already named. */
  const namePrograms = async (ids: readonly string[]) => {
    const missing = [...new Set(ids)].filter((id) => !programName.has(id));
    if (missing.length === 0) return;
    const rows = await prisma.program.findMany({
      where: { id: { in: missing } },
      select: { id: true, name: true },
    });
    for (const r of rows) programName.set(r.id, r.name);
  };

  const metKeys = [...new Set(mySessionSums.map((s) => key(s)))].filter(
    (k) => !listed.has(k)
  );
  const metProfiles = await profilesFor(metKeys);
  await namePrograms(metKeys.map((k) => k.split(":")[1]));
  for (const k of metKeys) {
    const [studentId, programId] = k.split(":");
    const profile = metProfiles.get(studentId);
    if (!profile) continue;
    const drawn = used.get(k) ?? 0;
    const missed = missedBy.get(k) ?? 0;
    listed.add(k);
    students.push({
      profile,
      program: { id: programId, name: programName.get(programId) ?? "" },
      allocated: 0,
      completed: drawn - missed,
      missed,
      extra: extraBy.get(k) ?? 0,
      // Nothing was allotted, so every charged minute is the overdraw it is.
      remaining: -drawn,
      deadline: null,
      expired: false,
      approved: profile.user.status === USER_STATUS.ACTIVE,
      reach: "met",
    });
  }

  // Work an admin put on this mentor's list, for a student no group above
  // reached. A task is normally born beside the hours for it, so this is
  // usually empty — but a task moved to another mentor carries no hours with
  // it, and after a pass of reassignments a mentor owned a dozen students'
  // work while their own page listed ten people and their headline figure
  // counted only the hours they had been granted long ago. The students the
  // work belongs to were nowhere on it.
  const taskOnlyKeys = [
    ...new Set(
      myGoals
        .filter((g) => g.mentorId === mentorId)
        .map((g) => `${g.studentId}:${g.programId}`)
    ),
  ].filter((k) => !listed.has(k));
  const taskedProfiles = await profilesFor(taskOnlyKeys);
  await namePrograms(taskOnlyKeys.map((k) => k.split(":")[1]));
  for (const k of taskOnlyKeys) {
    const [studentId, programId] = k.split(":");
    const profile = taskedProfiles.get(studentId);
    if (!profile) continue;
    listed.add(k);
    students.push({
      profile,
      program: { id: programId, name: programName.get(programId) ?? "" },
      // Nothing granted and nothing spent: the row's own emptiness is the
      // news, and `studentStatuses` turns it into "No time with you".
      allocated: 0,
      completed: 0,
      missed: 0,
      extra: 0,
      remaining: 0,
      deadline: null,
      expired: false,
      approved: profile.user.status === USER_STATUS.ACTIVE,
      reach: "task",
    });
  }

  // Everyone else enrolled in the mentor's programs — the fifth leg, as a
  // list. Program-wide and cohort-blind, because that is what a mentor may log
  // against: being assigned to the program is the whole qualification.
  //
  // A student already listed for ONE program still belongs here for another
  // they share — the row above is a balance in the Master's Program, and the
  // Global Admissions meeting that has not happened yet still has to be
  // loggable.
  const myProgramIds = [...new Set(assignments.map((a) => a.programId))];
  const loggable = myProgramIds.length
    ? (
        await prisma.studentProfile.findMany({
          where: {
            user: { status: USER_STATUS.ACTIVE },
            enrollments: { some: { programId: { in: myProgramIds } } },
          },
          include: {
            user: true,
            enrollments: { include: { program: true } },
          },
          orderBy: { createdAt: "asc" },
        })
      )
        .map((p) => ({
          id: p.id,
          user: p.user,
          programs: p.enrollments
            .filter(
              (e) =>
                myProgramIds.includes(e.programId) &&
                !listed.has(`${p.id}:${e.programId}`)
            )
            .map((e) => ({ id: e.programId, name: e.program.name })),
        }))
        .filter((p) => p.programs.length > 0)
    : [];

  const sum = (rows: typeof lifetime) =>
    rows.reduce((n, d) => n + (d._sum.minutes ?? 0), 0);

  return {
    students,
    loggable,
    goalsByStudent,
    assignments,
    delivered: {
      minutes: sum(lifetime.filter((d) => d.withinPlan && d.attended)),
      missed: sum(lifetime.filter((d) => d.withinPlan && !d.attended)),
      extra: sum(lifetime.filter((d) => !d.withinPlan)),
      sessions: lifetime.reduce((n, d) => n + d._count, 0),
    },
  };
}

/**
 * The log-a-session picker's options, in the order a mentor picks them.
 *
 * Students holding live time first, because that is who a mentor is logging
 * for on a normal Monday; everyone else in their programs next, because that
 * pick exists for the meeting that happened before any hours were granted;
 * and forfeited balances last, where only extra hours can still land. Both
 * lines are searchable, so an email is there to be typed at, not read.
 *
 * ONE OPTION PER PERSON, carrying the programs a log could land in. The
 * caseload is per (student, program) — that is what a balance is — but a mentor
 * picking a student is picking a person, and offering the same name twice with
 * two balances under it is a puzzle, not a choice. So the rows are folded back
 * together here and the program becomes a second, smaller question the form
 * only asks when there is more than one answer.
 */
export function logSessionOptions(caseload: MentorCaseload) {
  const { students, loggable, goalsByStudent } = caseload;

  /** One program a session could be logged into, and what it holds. */
  type Choice = {
    id: string;
    name: string;
    balance: string;
    /** Sorts live time above bare reach, so the default pick is the useful one. */
    rank: number;
    goals: { value: string; label: string }[];
  };
  const byStudent = new Map<
    string,
    { label: string; email: string; choices: Choice[] }
  >();
  const at = (id: string, label: string, email: string) => {
    const row = byStudent.get(id) ?? { label, email, choices: [] };
    byStudent.set(id, row);
    return row;
  };

  for (const s of students) {
    // Approval is the one thing that closes the picker, because it is the one
    // thing `logSession` refuses outright. An EXPIRED balance does not: the
    // hours are forfeited and in-plan logging is closed, but the meeting still
    // happened and extra hours still record it — so the row stays, says so,
    // and sorts last. Dropping it was how a mentor lost the student from the
    // picker entirely the day their deadline passed.
    if (!s.approved) continue;
    const row = at(
      s.profile.id,
      s.profile.user.name ?? s.profile.user.email,
      s.profile.user.email
    );
    row.choices.push({
      id: s.program.id,
      name: s.program.name,
      balance: s.expired
        ? `Hours expired${s.deadline ? ` ${formatDate(s.deadline)}` : ""} — extra hours only`
        : s.pool != null
          ? `${formatDuration(s.pool)} unassigned — logging makes it yours`
          : s.allocated > 0
            ? `${formatDuration(s.remaining)} remaining with you`
            : "No time allocated to you",
      rank: s.expired ? 3 : s.pool != null || s.allocated > 0 ? 0 : 1,
      goals: goalsByStudent.get(`${s.profile.id}:${s.program.id}`) ?? [],
    });
  }

  for (const p of loggable) {
    const row = at(p.id, p.user.name ?? p.user.email, p.user.email);
    for (const program of p.programs) {
      if (row.choices.some((c) => c.id === program.id)) continue;
      row.choices.push({
        id: program.id,
        name: program.name,
        balance: "No time allocated to you",
        rank: 2,
        goals: goalsByStudent.get(`${p.id}:${program.id}`) ?? [],
      });
    }
  }

  const best = (row: { choices: Choice[] }) =>
    Math.min(...row.choices.map((c) => c.rank));

  return [...byStudent.entries()]
    // Students holding live time first, then everyone else, then alphabetical
    // inside each group — the order the picker is read in.
    .sort(([, a], [, b]) => best(a) - best(b) || a.label.localeCompare(b.label))
    .map(([profileId, row]) => {
      const choices = [...row.choices].sort(
        (a, b) => a.rank - b.rank || a.name.localeCompare(b.name)
      );
      const lead = choices[0];
      return {
        profileId,
        label: row.label,
        // The hint is what the searchable dropdown shows on the closed row, so
        // it names the program only when the choice is real.
        hint:
          choices.length === 1
            ? `${lead.balance} · ${lead.name} · ${row.email}`
            : `${choices.length} programs · ${row.email}`,
        programs: choices.map((c) => ({
          value: c.id,
          label: c.name,
          balance: c.balance,
          goals: c.goals,
        })),
        // Shown under the closed select, where the dropdown's searchable hint
        // is no longer visible and the one thing a mentor re-checks before
        // typing minutes is how much time there is to spend.
        balance: lead.balance,
        goals: lead.goals,
      };
    });
}
