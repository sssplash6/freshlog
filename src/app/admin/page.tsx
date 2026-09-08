import { AttentionList } from "@/components/attention-list";
import { ApproveStudentButtons } from "@/components/forms/approve-student-buttons";
import { Timeline, type TimelineEntry } from "@/components/timeline";
import { Figure } from "@/components/ui/figure";
import { ArrowLink } from "@/components/ui/link";
import { PageTitle, Section } from "@/components/ui/section";
import { Table, Td, Tr, type Column } from "@/components/ui/table";
import {
  ASSIGNMENT_PROGRESS,
  INTERVIEW_STATUS,
  ROLES,
  SESSION_STATUS,
} from "@/lib/constants";
import { adminScope, scopeProgramFilter } from "@/lib/authz";
import { requireStaff } from "@/lib/dal";
import { dismissalKey, notDismissed } from "@/lib/status";
import { formatRough } from "@/lib/format";
import { programTotals } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { recentNotifications, studentsWithHours } from "@/lib/queries";
import {
  actionableCount,
  attentionList,
  meetingStatus,
  mentorStatuses,
  status,
  studentStatuses,
  taskStatuses,
  type Status,
  type StatusType,
  type ViewerContext,
} from "@/lib/status";
import { formatTimeOfDay, programWallClock } from "@/lib/when";

/**
 * The admin inbox: is anything in my programs waiting on me right now?
 *
 * The page it replaces asked that question in its heading and then answered a
 * different one — a greeting banner, an orange "awaiting assignment" pill, an
 * amber approvals callout, five equally loud lifetime totals and an EDITABLE
 * log of sessions other people had already logged, all of it above the only
 * link into a program. Reading it told you what the school had done, never what
 * it was waiting for.
 *
 * So: four lists and a line of context. This page derives no wording and picks
 * no colour — it asks `lib/status.ts` what is true about students, mentors,
 * tasks and meetings, and renders what it is told, already in a staff voice.
 */

/**
 * The states this inbox asks about: approvals, time, meetings, mentors, tasks,
 * feedback (§6.1).
 *
 * The producers in `lib/status.ts` know more than that — who has never signed
 * in, whose time sits in the unassigned pool, who has no mentor — and those are
 * facts about ONE person, best read on their own page or in the students list
 * where the fix is to hand. Naming the set here is what keeps this screen a
 * question of fixed size instead of however much the producers happen to emit
 * about however many students the school has.
 */
const NEEDS_YOU = new Set<StatusType>([
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
]);

/** At most twenty rows, and more than three of one state collapse to a line. */
const ROW_CAP = 20;
const ROLL_UP_AT = 3;
/** Up next is a week's diary, not a ledger. */
const UP_NEXT_CAP = 10;

const DAY = 24 * 60 * 60 * 1000;

/** "1 program", "3 programs" — the one place this page pluralises. */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** A status and the program it belongs to, before either is presented. */
type Flag = { programId: string | null; status: Status };

export default async function AdminInboxPage() {
  const user = await requireStaff();

  // Everything on this page is counted per program and then summed, so the
  // reader's grants are applied ONCE here and every read below carries them.
  // `undefined` is a platform admin and means no filter at all — not "every id
  // I happen to have fetched", which would go stale the moment a program is
  // created.
  const programIds = scopeProgramFilter(await adminScope(user));
  const dismissed = new Set(
    (
      await prisma.statusDismissal.findMany({
        where: { userId: user.id },
        select: { type: true, subjectId: true },
      })
    ).map((d) => dismissalKey(d.type, d.subjectId))
  );
  const inScope = programIds ? { in: [...programIds] } : undefined;
  // "Belongs to a program I administer", in the two shapes the rows come in:
  // a session, a grant and a task each name their own program now, while a
  // rating and a scheduled meeting name none and are reached through the
  // student's enrollments.
  const ofMine = inScope ? { programId: inScope } : {};
  const ofMyStudents = inScope
    ? { student: { enrollments: { some: { programId: inScope } } } }
    : {};

  // One instant for the whole render, so no two sections can disagree about
  // what today is or what has expired.
  const now = new Date();
  const viewer: ViewerContext = { audience: "staff", userId: user.id, now };
  // A meeting time is the program's wall clock kept in a UTC field, which runs
  // five hours ahead of this instant. A day of slack on the bound costs one
  // extra row to discard and saves doing calendar arithmetic twice — `Timeline`
  // re-buckets every row against `now` anyway.
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
    feed,
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
    // Both a passed meeting for Needs you and the week ahead for Up next come
    // out of this one list.
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
      include: {
        mentor: true,
        student: {
          include: {
            user: true,
            enrollments: {
              ...(inScope ? { where: { programId: inScope } } : {}),
              orderBy: { program: { name: "asc" } },
              select: { programId: true },
            },
          },
        },
      },
      orderBy: { scheduledAt: "asc" },
    }),
    recentNotifications(user.id),
  ]);

  const programById = new Map(programs.map((p) => [p.id, p]));
  const studentById = new Map(students.map((s) => [s.id, s]));
  // The soonest use-by date used to be a query of its own — `_min(deadline)`
  // per (student, program) — handed to `studentStatuses` beside a total
  // remaining that came from somewhere else. Two sources for the two halves of
  // one sentence is what let them disagree; `studentsWithHours` now returns
  // the pair, and this query is gone.
  const ratingByMentor = new Map(ratings.map((r) => [r.mentorId, r]));
  const minutesByTask = new Map(
    taskMinutes.map((t) => [t.assignmentId ?? "", t._sum.minutes ?? 0])
  );

  /**
   * Everything true and worth saying, tagged with the program it happened in.
   *
   * The tag is the page's own: `taskStatuses` and `meetingStatus` describe a
   * thing whose program they were never handed, and section 4 needs a count per
   * program that agrees with section 2 to the row. Attaching it here — where
   * the student, and therefore the program, is still in hand — is what keeps
   * the two sections from being two different derivations of one number.
   */
  const flags: Flag[] = [];
  const flag = (programId: string | null, list: Status[]) => {
    const program = programId ? programById.get(programId) : undefined;
    for (const s of list) {
      if (!NEEDS_YOU.has(s.type)) continue;
      flags.push({
        programId: programId ?? null,
        status: {
          ...s,
          ...(program ? { program } : {}),
          ...(s.href ? { href: s.href } : {}),
        },
      });
    }
  };

  /**
   * A student is read once PER PROGRAM they are in, with that program's
   * figures — because that is where their balance lives. Somebody overdrawn in
   * the Master's Program and comfortable in Global Admissions is one flag, on
   * the right program, and a merged reading would be neither.
   *
   * Three of the rows are about the ACCOUNT rather than the hours — waiting for
   * approval, never signed in, a placeholder email — and are true once however
   * many programs the person is in. They are kept from the first program and
   * dropped from the rest, so the inbox says "approve Malika" once.
   */
  const ACCOUNT_LEVEL = new Set<StatusType>([
    "STUDENT_PENDING_APPROVAL",
    "STUDENT_NOT_SIGNED_IN",
    "STUDENT_PLACEHOLDER_EMAIL",
  ]);
  for (const s of students) {
    let first = true;
    for (const [programId, figures] of s.byProgram) {
      const rows = studentStatuses(
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
      flag(
        programId,
        first ? rows : rows.filter((r) => !ACCOUNT_LEVEL.has(r.type))
      );
      first = false;
    }
  }

  for (const m of mentors) {
    const theirs = pairings.filter((p) => p.mentorId === m.id);
    const rating = ratingByMentor.get(m.id);
    // No program tag: a mentor works across several, and their setup is not one
    // program's problem to count.
    flag(
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
    flag(
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

  // A meeting is in exactly one state, and both sections below read it: Needs
  // you keeps the ones that have passed unlogged, Up next carries the rest as a
  // chip. Deciding it once is also what stops the two disagreeing.
  const meetingState = new Map(
    meetings.map((m) => [
      m.id,
      meetingStatus(
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
      ),
    ])
  );
  for (const m of meetings) {
    const state = meetingState.get(m.id);
    // A scheduled meeting names no program, so it is tagged with the
    // student's — the first alphabetically when they are in several, which is
    // arbitrary but keeps the per-program counts adding up to the total.
    if (state) flag(m.student.enrollments[0]?.programId ?? null, [state]);
  }

  // Nothing in scope at all is a state, not an empty page: one line that says
  // so, in place of the three copies of a "staff configuration" sentence this
  // replaces.
  if (programs.length === 0) {
    const unscoped = status("STAFF_UNSCOPED", viewer);
    if (unscoped) flags.push({ programId: null, status: unscoped });
  }

  const needsYou = attentionList(
    // Rows this reader has silenced are dropped before the roll-up, so hiding
    // eight of ten does not leave a row saying "10 students…".
    flags.map((f) => f.status).filter(notDismissed(dismissed)),
    viewer,
    { threshold: ROLL_UP_AT }
  );
  const shown = needsYou.slice(0, ROW_CAP);
  const spilled = needsYou.length - shown.length;

  /**
   * Up next is chronology, whatever the row is about: a use-by date three days
   * out matters more than a meeting next month, and both belong to the same
   * question. Task due dates join them once `Assignment.deadline` becomes a
   * real date (M6) — today it holds free text like "March-May", which is why
   * `TASK_OVERDUE` is dormant rather than guessed at.
   */
  const upNext: TimelineEntry[] = [];
  for (const m of meetings) {
    upNext.push({
      id: m.id,
      at: m.scheduledAt,
      hasTime: m.hasTime,
      // Staff are neither party, and the row has one slot for a person. The
      // student gets the chip because the row is about them and links to them;
      // the mentor is named in the title, because who is running the meeting is
      // the one fact an admin cannot recover from anywhere else on this page.
      title: `Meeting with ${m.mentor.name ?? m.mentor.email}`,
      status: meetingState.get(m.id),
      person: m.student.user,
      href: `/students/${m.studentId}`,
      joinUrl: m.link,
      note: m.note,
    });
  }
  for (const { status: s } of flags) {
    if (s.type !== "ALLOCATION_EXPIRING" || !s.subject || !s.at) continue;
    const student = studentById.get(s.subject.id);
    upNext.push({
      // The program is in the key: a student expiring in two programs is two
      // rows, and keying on the student alone gave them the same React key.
      id: `use-by-${s.subject.id}-${s.program?.id ?? ""}`,
      at: s.at,
      hasTime: false,
      // The chip already says "4h 38m expires September 30", so the title names
      // the kind of row rather than repeating the verb back.
      title: "Use-by date",
      status: s,
      person: student?.user ?? null,
      ...(s.href ? { href: s.href } : {}),
    });
  }

  const overall = programTotals(students);
  const rows = programs.map((p) => {
    // That program's figures for each student in it — never the student's
    // combined row, which would put another program's hours in this total and
    // count a two-program student twice.
    const enrolled = students.flatMap((s) => {
      const figures = s.byProgram.get(p.id);
      return figures ? [figures] : [];
    });
    const totals = programTotals(enrolled);
    return {
      ...p,
      students: totals.students,
      mentors: new Set(
        pairings.filter((a) => a.programId === p.id).map((a) => a.mentorId)
      ).size,
      remaining: totals.remaining,
      attention: actionableCount(
        flags.filter((f) => f.programId === p.id).map((f) => f.status)
      ),
    };
  });

  const columns: Column[] = [
    { label: "Program" },
    { label: "Students", align: "right" },
    { label: "Mentors", align: "right" },
    { label: "Remaining", align: "right" },
    { label: "Needs you", align: "right" },
    {},
  ];

  return (
    <div className="space-y-6">
      <PageTitle
        title="Inbox"
        subtitle={
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span>
              {count(programs.length, "program")} ·{" "}
              {count(overall.students, "student")} ·
            </span>
            <Figure
              size="inline"
                            value={formatRough(overall.remaining)}
              tone={overall.remaining < 0 ? "danger" : "hours"}
            />
            <span>remaining</span>
          </span>
        }
        // The render time, from the server clock. Freshness is chrome, and this
        // is the one page with the plumbing to claim it honestly.
        actions={
          <span className="text-[13px] text-muted-fg">
            Updated {formatTimeOfDay(programWallClock(now), true)}
          </span>
        }
      />

      <AttentionList
        dismissible
        statuses={shown}
        feed={feed}
        renderAction={(s) =>
          s.type === "STUDENT_PENDING_APPROVAL" && s.subject ? (
            <ApproveStudentButtons studentProfileId={s.subject.id} />
          ) : null
        }
        {...(spilled > 0
          ? { moreHref: "/students", moreLabel: `${spilled} more` }
          : {})}
      />

      <Timeline
        entries={upNext}
        now={now}
        buckets={["today", "week"]}
        limit={UP_NEXT_CAP}
      />

      {/* One program is the whole scope, and a table of one row that repeats
          the line under the title is furniture. */}
      {programs.length > 1 && (
        <Section title="Programs">
          <Table columns={columns} framed={false}>
            {rows.map((p) => (
              <Tr key={p.id}>
                <Td label="Program">
                  <span className="font-medium text-ink">{p.name}</span>
                </Td>
                <Td label="Students" align="right" className="tabular-nums">
                  {p.students}
                </Td>
                <Td label="Mentors" align="right" className="tabular-nums">
                  {p.mentors}
                </Td>
                <Td label="Remaining" align="right">
                  <Figure
                    size="inline"
                                        value={formatRough(p.remaining)}
                    tone={p.remaining < 0 ? "danger" : "hours"}
                    className="sm:text-right"
                  />
                </Td>
                <Td label="Needs you" align="right">
                  {p.attention > 0 ? (
                    <span className="font-medium tabular-nums text-ink">
                      {p.attention}
                    </span>
                  ) : (
                    <span className="text-muted-fg">—</span>
                  )}
                </Td>
                <Td align="right">
                  <ArrowLink
                    href={`/programs/${p.id}`}
                    className="text-[13px]"
                  >
                    Open
                  </ArrowLink>
                </Td>
              </Tr>
            ))}
          </Table>
        </Section>
      )}

    </div>
  );
}


