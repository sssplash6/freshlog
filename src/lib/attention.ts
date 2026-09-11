import "server-only";

import { adminScope, scopeProgramFilter } from "@/lib/authz";
import {
  ASSIGNMENT_PROGRESS,
  INTERVIEW_STATUS,
  ROLES,
  SESSION_STATUS,
  USER_STATUS,
  canActAsMentor,
  interviewIsOpen,
} from "@/lib/constants";
import { soonestExpiry } from "@/lib/deadlines";
import { unallocatedExchanges } from "@/lib/exchanges";
import { allocationSummary } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import type { Profile } from "@/lib/profile";
import {
  assignmentsForStudentWhere,
  mentorCaseload,
  mentorMeetings,
  studentLedger,
  studentMeetings,
  studentsWithHours,
} from "@/lib/queries";
import {
  attentionList,
  dismissalKey,
  exchangeStatuses,
  meetingStatus,
  mentorStatuses,
  notDismissed,
  programStatuses,
  sessionStatuses,
  status,
  studentStatuses,
  taskStatuses,
  type Status,
  type StatusType,
  type ViewerContext,
} from "@/lib/status";
import type { User } from "@/generated/prisma/client";

/**
 * What needs this reader, whoever they are.
 *
 * It lived three times, inline, at the top of three home pages — about 250
 * lines on /admin, 80 on /mentor and 120 on /student — and the whole of it
 * rendered into a section each of those pages opened with. The owner asked
 * for one place to find out what is waiting: the bell. So the derivation is
 * here, the three homes render none of it, and `/notifications` is the one
 * page that reads it.
 *
 * The three branches are the three readers and are deliberately NOT merged.
 * They ask different questions of different rows — an admin is told about
 * every student in their programs, a mentor only about the hours they
 * themselves hold, a student only about their own — and a single query
 * pretending to serve all three is how one of them ends up reading somebody
 * else's balance. What they share is `lib/status.ts`, which writes every row's
 * words in the reader's own voice; nothing in this file chooses a word or a
 * colour.
 *
 * Every branch answers with the same shape, so the page renders one section
 * and never asks who is looking at it.
 */

/** At most twenty rows, and more than three of one state collapse to a line. */
const ROW_CAP = 20;
const ROLL_UP_AT = 3;
/** A mentor's list is capped shorter: it is a caseload, not a school. */
const MENTOR_ROWS = 10;

const DAY = 24 * 60 * 60 * 1000;

export type Attention = {
  /** The rows to render, already rolled up, sorted and capped. */
  statuses: Status[];
  /** How many the cap discarded, so a capped list cannot read as a whole one. */
  spilled: number;
  /** Where the discarded ones can be found, when there is such a place. */
  moreHref?: string;
  /** May a row be silenced? Not on a student's, whose rows are all their own. */
  dismissible: boolean;
  /**
   * The meeting each RSVP row is about, keyed by the row OBJECT.
   *
   * A `Status` carries no id, so the buttons are looked up by identity — the
   * same object the renderer hands back. A rolled-up row is a new object and
   * finds nothing here, which is the right answer: four proposed meetings
   * cannot be settled with one pair of buttons.
   */
  answers: Map<Status, { id: string; status: string }>;
  /** What to say when there is nothing, in this reader's words. */
  empty: string;
};

const NOTHING: Attention = {
  statuses: [],
  spilled: 0,
  dismissible: false,
  answers: new Map(),
  empty: "Nothing needs you.",
};

/** Rows this reader has silenced, as the keys `notDismissed` compares. */
async function dismissedBy(userId: string) {
  const rows = await prisma.statusDismissal.findMany({
    where: { userId },
    select: { type: true, subjectId: true },
  });
  return new Set(rows.map((d) => dismissalKey(d.type, d.subjectId)));
}

export async function attentionFor(
  user: User,
  profile: Profile
): Promise<Attention> {
  if (user.role === ROLES.STUDENT) return studentAttention(user);
  if (profile === "mentor" && canActAsMentor(user)) return mentorAttention(user);
  return staffAttention(user);
}

/* ------------------------------------------------------------------ *
 * Staff
 * ------------------------------------------------------------------ */

/**
 * The states an admin is asked about: approvals, time, meetings, mentors,
 * tasks, feedback (§6.1).
 *
 * The producers in `lib/status.ts` know more than that — who has never signed
 * in, whose time sits in the unassigned pool, who has no mentor — and those
 * are facts about ONE person, best read on their own page or in the students
 * list where the fix is to hand. Naming the set here is what keeps this list a
 * question of fixed size instead of however much the producers happen to emit
 * about however many students the school has.
 */
const STAFF_STATES = new Set<StatusType>([
  "STUDENT_PENDING_APPROVAL",
  "STUDENT_PLACEHOLDER_EMAIL",
  "BALANCE_OVERDRAWN",
  "BALANCE_NONE",
  "ALLOCATION_EXPIRING",
  "ALLOCATION_EXPIRED",
  "MEETING_UNLOGGED",
  "MENTOR_UNASSIGNED",
  "BOOKING_LINK_MISSING",
  "TASK_OVERDUE",
  "TASK_NEEDS_MENTOR",
  "FEEDBACK_LOW",
  "STAFF_UNSCOPED",
  // A student another program lent us and nobody here holds the hours for. It
  // is the only row in this list about somebody who is not our own student,
  // and it is the whole of what an exchange asks of a host admin.
  "EXCHANGE_UNALLOCATED",
  // A program with students and nobody to teach them. It used to be the one
  // row on `/programs/[id]`'s list that nothing else in the app could say, so
  // it comes here rather than being deleted with that list.
  "PROGRAM_NO_MENTORS",
]);

/**
 * Three of the student rows are about the ACCOUNT rather than the hours —
 * waiting for approval, never signed in, a placeholder email — and are true
 * once however many programs the person is in. They are kept from the first
 * program and dropped from the rest, so the list says "approve Malika" once.
 */
const ACCOUNT_LEVEL = new Set<StatusType>([
  "STUDENT_PENDING_APPROVAL",
  "STUDENT_NOT_SIGNED_IN",
  "STUDENT_PLACEHOLDER_EMAIL",
]);

async function staffAttention(user: User): Promise<Attention> {
  // The reader's grants are applied ONCE here and every read below carries
  // them. `undefined` is a platform admin and means no filter at all — not
  // "every id I happen to have fetched", which would go stale the moment a
  // program is created.
  const programIds = scopeProgramFilter(await adminScope(user));
  const dismissed = await dismissedBy(user.id);
  const inScope = programIds ? { in: [...programIds] } : undefined;
  // "Belongs to a program I administer", in the two shapes the rows come in:
  // a session, a grant and a task each name their own program now, while a
  // rating and a scheduled meeting name none and are reached through the
  // student's enrollments.
  const ofMine = inScope ? { programId: inScope } : {};
  const ofMyStudents = inScope
    ? { student: { enrollments: { some: { programId: inScope } } } }
    : {};

  // One instant for the whole derivation, so no two rows can disagree about
  // what today is or what has expired.
  const now = new Date();
  const viewer: ViewerContext = { audience: "staff", userId: user.id, now };
  // A meeting time is the program's wall clock kept in a UTC field, which runs
  // five hours ahead of this instant. A day of slack on the bound costs one
  // extra row to discard and saves doing calendar arithmetic twice.
  const horizon = new Date(now.getTime() + 8 * DAY);

  const [
    programs,
    students,
    pairings,
    mentors,
    ratings,
    unassignedTasks,
    taskMinutes,
    meetings,
    exchanges,
  ] = await Promise.all([
    prisma.program.findMany({
      where: inScope ? { id: inScope } : {},
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    studentsWithHours(
      inScope ? { enrollments: { some: { programId: inScope } } } : {},
      { now, programIds }
    ),
    prisma.mentorAssignment.findMany({
      where: inScope ? { programId: inScope } : {},
      select: { mentorId: true, programId: true, calendlyUrl: true },
    }),
    // The same pool the mentors list works from: plain mentors plus dual-role
    // admins who also mentor. A mentor missing from here is a mentor whose
    // missing booking link nobody is told about.
    prisma.user.findMany({
      where: { OR: [{ role: ROLES.MENTOR }, { isMentor: true }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, status: true },
    }),
    prisma.mentorFeedback.groupBy({
      by: ["mentorId"],
      where: ofMyStudents,
      _avg: { rating: true },
      _count: true,
    }),
    prisma.assignment.findMany({
      where: {
        mentorId: null,
        progress: { not: ASSIGNMENT_PROGRESS.DONE },
        ...ofMine,
      },
      include: { program: true, student: { include: { user: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.session.groupBy({
      by: ["assignmentId"],
      where: {
        status: SESSION_STATUS.ACTIVE,
        assignment: { mentorId: null, ...ofMine },
      },
      _sum: { minutes: true },
    }),
    // Still in the diary: not cancelled, not held, nothing logged against it.
    prisma.interview.findMany({
      where: {
        sessionId: null,
        status: {
          in: [
            INTERVIEW_STATUS.PROPOSED,
            INTERVIEW_STATUS.CONFIRMED,
            INTERVIEW_STATUS.DECLINED,
          ],
        },
        scheduledAt: { lte: horizon },
        ...ofMyStudents,
      },
      include: { mentor: true, student: { include: { user: true } } },
      orderBy: { scheduledAt: "asc" },
    }),
    // Hosted by one of this reader's programs: an exchange is the sending
    // program's arrangement and the HOST's job, and it is the host who is
    // holding hours nobody is delivering.
    unallocatedExchanges({ ...(programIds ? { hostedBy: programIds } : {}) }),
  ]);

  const programById = new Map(programs.map((p) => [p.id, p]));
  const ratingByMentor = new Map(ratings.map((r) => [r.mentorId, r]));
  const minutesByTask = new Map(
    taskMinutes.map((t) => [t.assignmentId ?? "", t._sum.minutes ?? 0])
  );

  const rows: Status[] = [];
  /** Keep the states this reader is asked about, tagged with their program. */
  const keep = (programId: string | null, list: Status[]) => {
    const program = programId ? programById.get(programId) : undefined;
    for (const s of list) {
      if (!STAFF_STATES.has(s.type)) continue;
      rows.push({ ...s, ...(program ? { program } : {}) });
    }
  };

  // A student is read once PER PROGRAM they are in, with that program's
  // figures — because that is where their balance lives. Somebody overdrawn in
  // the Master's Program and comfortable in Global Admissions is one row, on
  // the right program, and a merged reading would be neither.
  for (const s of students) {
    let first = true;
    for (const [programId, figures] of s.byProgram) {
      const produced = studentStatuses(
        {
          id: s.id,
          name: s.user.name,
          email: s.user.email,
          accountStatus: s.user.status,
          telegramUsername: s.telegramUsername,
          allottedMinutes: figures.allottedMinutes,
          remainingMinutes: figures.remainingMinutes,
          forfeitedMinutes: figures.forfeitedMinutes,
          // From the same tally as every other figure on this row, rather
          // than a separate `_min(deadline)` query paired with a total.
          expiring: figures.expiring,
          program: { id: programId, name: figures.program.name },
        },
        viewer
      );
      keep(
        programId,
        first ? produced : produced.filter((r) => !ACCOUNT_LEVEL.has(r.type))
      );
      first = false;
    }
  }

  for (const e of exchanges) {
    keep(
      e.toProgramId,
      exchangeStatuses(
        {
          id: e.id,
          student: {
            id: e.studentId,
            name: e.student.user.name ?? e.student.user.email,
          },
          toProgram: e.toProgram,
          minutes: e.minutes,
          allocatedMinutes: e.figures.allocated,
          deadline: e.deadline,
        },
        viewer
      )
    );
  }

  for (const m of mentors) {
    const theirs = pairings.filter((p) => p.mentorId === m.id);
    const rating = ratingByMentor.get(m.id);
    // No program tag: a mentor works across several, and their setup is not
    // one program's problem to count.
    keep(
      null,
      mentorStatuses(
        {
          id: m.id,
          name: m.name,
          email: m.email,
          accountStatus: m.status,
          programCount: new Set(theirs.map((p) => p.programId)).size,
          pairingsMissingLink: theirs.filter((p) => !p.calendlyUrl).length,
          averageRating: rating?._avg.rating ?? null,
          ratingCount: rating?._count ?? 0,
        },
        viewer
      )
    );
  }

  for (const t of unassignedTasks) {
    keep(
      t.programId,
      taskStatuses(
        {
          id: t.id,
          purpose: t.purpose,
          progress: t.progress,
          mentorId: t.mentorId,
          minuteLimit: t.minuteLimit,
          loggedMinutes: minutesByTask.get(t.id) ?? 0,
          dueOn: t.dueOn,
          student: {
            id: t.studentId,
            name: t.student.user.name ?? t.student.user.email,
          },
        },
        viewer
      )
    );
  }

  for (const m of meetings) {
    const state = meetingStatus(
      {
        id: m.id,
        status: m.status,
        scheduledAt: m.scheduledAt,
        sessionId: m.sessionId,
        student: {
          id: m.studentId,
          name: m.student.user.name ?? m.student.user.email,
        },
      },
      viewer
    );
    if (state) keep(null, [state]);
  }

  for (const p of programs) {
    keep(p.id, [
      ...programStatuses(
        {
          id: p.id,
          name: p.name,
          // Deliberately not `status`: being archived is a fact about the
          // program that its own header states, and a row here repeating it is
          // the same thing charged twice.
          mentorCount: new Set(
            pairings.filter((a) => a.programId === p.id).map((a) => a.mentorId)
          ).size,
          studentCount: students.filter((s) => s.byProgram.has(p.id)).length,
        },
        viewer
      ),
    ]);
  }

  // Nothing in scope at all is a state, not an empty list: one line that says
  // so, in place of the three copies of a "staff configuration" sentence this
  // replaces.
  if (programs.length === 0) {
    const unscoped = status("STAFF_UNSCOPED", viewer);
    if (unscoped) rows.push(unscoped);
  }

  // Rows this reader has silenced are dropped BEFORE the roll-up, so hiding
  // eight of ten does not leave a row saying "10 students…".
  const list = attentionList(rows.filter(notDismissed(dismissed)), viewer, {
    threshold: ROLL_UP_AT,
  });
  return {
    statuses: list.slice(0, ROW_CAP),
    spilled: Math.max(0, list.length - ROW_CAP),
    moreHref: "/students",
    dismissible: true,
    answers: new Map(),
    empty: "Nothing needs you.",
  };
}

/* ------------------------------------------------------------------ *
 * Mentor
 * ------------------------------------------------------------------ */

async function mentorAttention(user: User): Promise<Attention> {
  const viewer: ViewerContext = {
    audience: "mentor",
    userId: user.id,
    now: new Date(),
  };
  const dismissed = await dismissedBy(user.id);
  const { students, assignments } = await mentorCaseload(user.id);
  const [diary, ratings, sent] = await Promise.all([
    mentorMeetings(user.id),
    prisma.mentorFeedback.aggregate({
      where: { mentorId: user.id },
      _avg: { rating: true },
      _count: true,
    }),
    // Students this mentor lent to another program, whose hours nobody there
    // has taken on yet. Nothing for them to do about it — the host allocates —
    // but they are the one who promised it, and the one the student will ask.
    unallocatedExchanges({ sentBy: user.id }),
  ]);
  const programCount = new Set(assignments.map((a) => a.programId)).size;

  const rows: Status[] = [
    ...mentorStatuses(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        accountStatus: user.status,
        programCount,
        pairingsMissingLink: assignments.filter((a) => !a.calendlyUrl).length,
        averageRating: ratings._avg.rating,
        ratingCount: ratings._count,
      },
      viewer
    ).map((s) =>
      // A mentor fixes their own booking link where the form is, which is
      // /settings — not on the page other people read about them.
      s.type === "BOOKING_LINK_MISSING" ? { ...s, href: "/settings" } : s
    ),
    ...students.flatMap((s) =>
      studentStatuses(
        {
          id: s.profile.id,
          name: s.profile.user.name,
          email: s.profile.user.email,
          accountStatus: s.profile.user.status,
          telegramUsername: s.profile.telegramUsername,
          // Deliberately this mentor's own numbers, not the student's total: a
          // mentor is told about the hours THEY hold, because those are the
          // ones they can spend. Someone else's expiring allocation is an
          // admin's row.
          allottedMinutes: s.allocated,
          remainingMinutes: s.remaining,
          forfeitedMinutes: s.expired
            ? Math.max(0, s.allocated - s.completed - s.missed)
            : 0,
          poolMinutes: s.pool ?? 0,
          // Already one grant, so the pair is this row's own remaining and its
          // own date — the aggregate confusion cannot arise here.
          expiring: soonestExpiry([s], viewer.now),
          mentorCount: 1,
          program: { id: s.program.id, name: s.program.name },
        },
        viewer
      ).map((row) => ({ ...row, href: `/students/${s.profile.id}` }))
    ),
    ...diary.flatMap((m) => {
      const state = meetingStatus(
        {
          id: m.id,
          status: m.status,
          scheduledAt: m.scheduledAt,
          sessionId: m.sessionId,
          student: {
            id: m.student.id,
            name: m.student.user.name ?? m.student.user.email,
          },
        },
        viewer
      );
      // Informational rows are kept. §6.2 puts "awaiting the student's answer"
      // in this list on purpose, and dropping it meant a mentor who booked an
      // interview for the 25th never learned the student had not replied. They
      // do not count toward the badge; `attentionList` sorts them last.
      if (!state) return [];
      return [
        state.type === "MEETING_UNLOGGED"
          ? // The row's job is to discharge itself: the form arrives knowing
            // the student and the day, so all that is left is a duration.
            { ...state, href: `/sessions/new?meeting=${m.id}` }
          : { ...state, href: `/students/${m.student.id}` },
      ];
    }),
    ...sent.flatMap((e) =>
      exchangeStatuses(
        {
          id: e.id,
          student: {
            id: e.studentId,
            name: e.student.user.name ?? e.student.user.email,
          },
          toProgram: e.toProgram,
          minutes: e.minutes,
          allocatedMinutes: e.figures.allocated,
          deadline: e.deadline,
        },
        viewer
      )
    ),
  ];

  const live = rows.filter(notDismissed(dismissed));
  const all = attentionList(live, viewer);
  return {
    statuses: all.slice(0, MENTOR_ROWS),
    spilled: Math.max(0, all.length - MENTOR_ROWS),
    dismissible: true,
    answers: new Map(),
    empty: "Nothing needs you.",
  };
}

/* ------------------------------------------------------------------ *
 * Student
 * ------------------------------------------------------------------ */

/**
 * A row about the reader themself, addressed to the reader.
 *
 * `studentStatuses` names its subject and links it at `/students/<id>`, which
 * is right for the staff and mentor lists it also feeds and wrong twice over
 * here: the subject is the person holding the phone, and the link leads to a
 * page that redirects a student straight back to their own. The one
 * destination that helps is the page where the time can actually be spent, so
 * an expiry points there and everything else points nowhere.
 */
function aboutMe(s: Status): Status {
  return {
    ...s,
    subject: undefined,
    href: s.type === "ALLOCATION_EXPIRING" ? "/student/book" : undefined,
  };
}

async function studentAttention(user: User): Promise<Attention> {
  const now = new Date();
  const viewer: ViewerContext = { audience: "student", userId: user.id, now };

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    include: { enrollments: true },
  });
  // Everything unfinished about this account is finished at /onboarding, and
  // the shell sends them there; there is nothing to tell them here meanwhile.
  if (!profile || user.status === USER_STATUS.PENDING) return NOTHING;

  const [hours, ledger, meetings, pairings] = await Promise.all([
    allocationSummary(profile.id),
    studentLedger(profile.id),
    studentMeetings(profile.id),
    prisma.mentorAssignment.findMany({
      where: assignmentsForStudentWhere(profile),
      include: { mentor: true },
    }),
  ]);

  // Time granted before a mentor was chosen. An expired pool has nothing left
  // to assign, and `allocationSummary` has already written it down to zero.
  const pool = hours.perMentor
    .filter((m) => !m.mentor)
    .reduce((total, m) => total + Math.max(0, m.remaining), 0);
  const mine = studentStatuses(
    {
      id: profile.id,
      name: user.name,
      email: user.email,
      accountStatus: user.status,
      telegramUsername: profile.telegramUsername,
      allottedMinutes: hours.allotted,
      remainingMinutes: hours.remaining,
      forfeitedMinutes: hours.forfeited,
      poolMinutes: pool,
      expiring: hours.expiring,
      // Paired mentors, not mentors who have logged something: a mentor with
      // no grant of their own is not the pairing NO_MENTOR asks an admin for.
      mentorCount: hours.perMentor.filter((m) => m.mentor && m.allocated > 0)
        .length,
    },
    viewer
  ).map(aboutMe);

  const answers = new Map<Status, { id: string; status: string }>();
  const meetingRows = meetings.filter(interviewIsOpen).flatMap((m) => {
    const s = meetingStatus(
      {
        id: m.id,
        status: m.status,
        scheduledAt: m.scheduledAt,
        sessionId: m.sessionId,
      },
      viewer
    );
    if (!s || s.type !== "MEETING_AWAITING_ANSWER") return [];
    // Whose meeting it is: the status is voiced at the reader, so the only
    // name worth carrying is the other person's.
    const row: Status = {
      ...s,
      subject: {
        kind: "mentor",
        id: m.mentor.id,
        name: m.mentor.name ?? m.mentor.email,
      },
    };
    answers.set(row, { id: m.id, status: m.status });
    return [row];
  });

  // Every state each task is in. `TASK_OVERDUE` is the only one a student can
  // act on, and it is dormant until `Assignment.dueOn` is a real date on every
  // row — it is wired anyway, so filling that column lights the row up instead
  // of waiting for somebody to remember this file.
  const overdueTasks = ledger.assignments.flatMap((task) =>
    taskStatuses(
      {
        id: task.id,
        purpose: task.purpose,
        progress: task.progress,
        mentorId: task.mentorId,
        minuteLimit: task.minuteLimit,
        loggedMinutes: task.loggedMinutes,
        dueOn: task.dueOn,
      },
      viewer
    ).filter((s) => s.type === "TASK_OVERDUE")
  );

  // The product's worst dead end, from the student's side: they hold time with
  // someone and have no way to book it. One row per mentor, so the row names
  // who to chase.
  const holdsTime = new Set(
    hours.perMentor.flatMap((m) =>
      m.mentor && m.remaining > 0 ? [m.mentor.id] : []
    )
  );
  // A mentor can be paired twice, once program-wide and once for the cohort,
  // so what matters is whether they have a link anywhere.
  const linked = new Set(
    pairings.flatMap((p) => (p.calendlyUrl ? [p.mentorId] : []))
  );
  const paired = new Map(pairings.map((p) => [p.mentorId, p.mentor]));
  const bookingRows = [...holdsTime].flatMap((id) => {
    const mentor = paired.get(id);
    if (!mentor || linked.has(id)) return [];
    const s = status(
      "BOOKING_LINK_MISSING",
      viewer,
      {},
      {
        subject: { kind: "mentor", id, name: mentor.name ?? mentor.email },
        href: "/student/book",
      }
    );
    return s ? [s] : [];
  });

  // Sessions their mentors logged that they have not spoken about yet, each a
  // link to the page that can answer it.
  const unconfirmed = ledger.sessions.flatMap((s) => {
    const row = sessionStatuses(
      {
        attended: s.attended,
        late: s.late,
        status: s.status,
        withinPlan: s.withinPlan,
        studentAnswer: s.studentAnswer,
        date: s.date,
      },
      viewer
    ).find((x) => x.type === "SESSION_UNCONFIRMED");
    return row
      ? [
          {
            ...row,
            subject: {
              kind: "mentor" as const,
              id: s.mentor.id,
              name: s.mentor.name ?? s.mentor.email,
            },
            href: "/student/meetings",
            at: s.date,
          },
        ]
      : [];
  });

  // `attentionList` adds an ALL_CLEAR row when nothing is actionable, which
  // the section already says in its own words — and with an informational row
  // still on screen, "Nothing to do right now" would be contradicted by the
  // line directly under it.
  const list = attentionList(
    [...mine, ...meetingRows, ...overdueTasks, ...bookingRows, ...unconfirmed],
    viewer
  ).filter((s) => s.type !== "ALL_CLEAR");

  return {
    statuses: list,
    spilled: 0,
    // A student's rows are all about their own time. There is nothing here
    // they should be able to make go away without doing something about it.
    dismissible: false,
    answers,
    empty: "Nothing to do right now.",
  };
}
