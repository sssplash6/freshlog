import Link from "next/link";
import { redirect } from "next/navigation";

import { AttentionList } from "@/components/attention-list";
import { ExpandableText } from "@/components/expandable-text";
import { InterviewResponse } from "@/components/forms/interview-response";
import { HoursBreakdown } from "@/components/hours-breakdown";
import { HoursRing } from "@/components/hours-ring";
import { PersonChip } from "@/components/person-chip";
import { Timeline, type TimelineEntry } from "@/components/timeline";
import { Disclosure } from "@/components/ui/disclosure";
import { SessionRow, toSessionEntries } from "@/components/session-row";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLink } from "@/components/ui/link";
import { Meter } from "@/components/ui/meter";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/cn";
import {
  ASSIGNMENT_PROGRESS,
  INTERVIEW_STATUS,
  ROLES,
  USER_STATUS,
  interviewIsOpen,
} from "@/lib/constants";
import { requireRole } from "@/lib/dal";
import { formatDate, formatMinutes } from "@/lib/format";
import { enrollmentsLabel } from "@/lib/enrollments";
import { allocationSummary } from "@/lib/hours";
import { bucketOf } from "@/lib/when";
import { prisma } from "@/lib/prisma";
import {
  assignmentsForStudentWhere,
  recentNotifications,
  studentLedger,
  studentMeetings,
  type LedgerAssignment,
} from "@/lib/queries";
import {
  attentionList,
  meetingStatus,
  sessionStatuses,
  status,
  studentStatuses,
  taskStatuses,
  type Status,
  type ViewerContext,
} from "@/lib/status";

/**
 * One piece of planned work, in the student's words.
 *
 * Private to this page rather than shared: the same task is a table row with a
 * ⋮ menu on a staff workspace (§6.7) and a read-only card here, and the two
 * have nothing in common but the noun. What they DO share — which states are
 * true of a task, and what each is called — comes from `taskStatuses`, so the
 * two renderings can never disagree about what "in progress" means.
 */
function TaskRow({ task, statuses }: { task: LedgerAssignment; statuses: Status[] }) {
  const budget = task.minuteLimit ?? 0;
  const over = budget > 0 && task.loggedMinutes > budget;

  return (
    <li className="border-b border-line bg-surface px-4 py-3.5 sm:px-5 sm:[&:nth-child(odd)]:border-r">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        {/* A purpose is occasionally written as a paragraph rather than a name,
            and one such row must not cost every other row its scanability. */}
        <div className="min-w-0 flex-1 text-[15px] font-semibold leading-snug">
          <ExpandableText text={task.purpose} lines={2} />
        </div>
        {/* Whichever half this task has. The note is free text — the tracking
            sheet holds both "Aug 7" and "March-May" — and carries no severity
            of its own; the row's own statuses say if it is overdue, which only
            a real dueOn can decide. */}
        {(task.dueNote ?? task.dueOn) && (
          <StatusChip severity="neutral" className="shrink-0">
            {task.dueNote ?? formatDate(task.dueOn!)}
          </StatusChip>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {task.mentor && <PersonChip person={task.mentor} size="sm" />}
        {statuses.map((s) => (
          <StatusChip key={s.type} status={s} />
        ))}
      </div>

      {budget > 0 ? (
        <>
          <Meter
            className="mt-3"
            size="sm"
            pct={Math.min(100, Math.round((task.loggedMinutes / budget) * 100))}
            tone={over ? "danger" : "accent"}
            ariaValueNow={task.loggedMinutes}
            ariaValueMax={budget}
            ariaLabel={`Time logged on ${task.purpose}`}
          />
          <p className="mt-1.5 text-xs text-muted-fg">
            <span
              className={cn(
                "font-semibold tabular-nums",
                over ? "text-danger-ink" : "text-ink",
              )}
            >
              {formatMinutes(task.loggedMinutes)}
            </span>{" "}
            of {formatMinutes(budget)}
          </p>
        </>
      ) : (
        task.loggedMinutes > 0 && (
          <p className="mt-2 text-xs text-muted-fg">
            <span className="font-semibold tabular-nums text-ink">
              {formatMinutes(task.loggedMinutes)}
            </span>{" "}
            logged
          </p>
        )
      )}
    </li>
  );
}

/**
 * Finished work, one line each behind a fold: reassuring to have, but it has
 * stopped asking anything, so it may not compete with what is still live.
 */
function FinishedTask({ task }: { task: LedgerAssignment }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span className="min-w-0 flex-1 truncate text-sm text-muted-fg">
        {task.purpose}
      </span>
      {task.mentor && <PersonChip person={task.mentor} size="sm" />}
      <span className="text-xs tabular-nums text-muted-fg">
        {formatMinutes(task.loggedMinutes)}
      </span>
    </li>
  );
}

/**
 * A row about the reader themself, addressed to the reader.
 *
 * `studentStatuses` names its subject and links it at `/students/<id>`, which
 * is right for the staff and mentor lists it also feeds and wrong twice over
 * here: the subject is the person holding the phone, and the link leads to a
 * page that redirects a student straight back to this one. The one destination
 * that helps is the page where the time can actually be spent, so an expiry
 * points there and everything else points nowhere.
 */
function aboutMe(s: Status): Status {
  return {
    ...s,
    subject: undefined,
    href: s.type === "ALLOCATION_EXPIRING" ? "/student/book" : undefined,
  };
}

/**
 * The student's home. Phone first, and that is the whole design.
 *
 * The question this page exists to answer — how much time have I left, what
 * needs doing, when am I meeting someone — used to be answered below the fold.
 * An orange gradient hero with a 120px ghost monogram opened it, the balance
 * was stated three times (ring, sentence, breakdown key), then two red
 * callouts, then thirteen unpaginated journey entries: on a 390×664 screen the
 * first thing that asked anything of the student sat past 900px. So the ring
 * moves beside the h1 at 96px, and everything with a question in it is one
 * section that begins under 300px.
 *
 * Nothing here writes a status's wording or picks its colour. Every row's words
 * come from `lib/status.ts` in the student's own voice, which is what makes a
 * meeting read "Needs your answer" instead of "Awaiting Aziza's answer", and
 * what keeps this page and the mentor's inbox from inventing two vocabularies
 * for the same fact.
 */
export default async function StudentHomePage() {
  const user = await requireRole(ROLES.STUDENT);
  const now = new Date();
  const viewer: ViewerContext = { audience: "student", userId: user.id, now };

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    include: { enrollments: { include: { program: true, cohort: true } } },
  });

  // Everything unfinished about this account is finished at /onboarding, and
  // that includes waiting to be approved. There is nothing to show a student
  // who has not said who they are, and nothing to show a PENDING one either:
  // no time is allocated until an admin approves them, /student/book turns
  // them away, and this page rendered a single blocked row surrounded by
  // sections about time they do not have. §6.20 gives that sentence a step of
  // its own instead.
  if (
    !profile ||
    !user.name?.trim() ||
    !profile.telegramUsername ||
    user.status === USER_STATUS.PENDING
  ) {
    redirect("/onboarding");
  }

  // Before the feed is read rather than after, so a deadline reminder this very
  // request creates is the change the page reports.

  const [hours, ledger, meetings, pairings, feed] = await Promise.all([
    allocationSummary(profile.id),
    studentLedger(profile.id),
    studentMeetings(profile.id),
    prisma.mentorAssignment.findMany({
      where: assignmentsForStudentWhere(profile),
      include: { mentor: true },
    }),
    recentNotifications(user.id),
  ]);

  // Time granted before a mentor was chosen. An expired pool has nothing left
  // to assign, and `allocationSummary` has already written it down to zero.
  const pool = hours.perMentor
    .filter((m) => !m.mentor)
    .reduce((total, m) => total + Math.max(0, m.remaining), 0);
  // The soonest use-by that still has time under it: an allocation already
  // spent, or already forfeited, has no expiry left to warn anyone about.
  const nextDeadline =
    hours.perMentor
      .flatMap((m) => (m.deadline && !m.expired && m.remaining > 0 ? [m.deadline] : []))
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

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
      nextDeadline,
      // Paired mentors, not mentors who have logged something: a mentor with no
      // grant of their own is not the pairing NO_MENTOR is asking an admin for.
      mentorCount: hours.perMentor.filter((m) => m.mentor && m.allocated > 0).length,
    },
    viewer
  ).map(aboutMe);

  // A `Status` carries no id of its own, so the RSVP is looked up by the status
  // object itself — the same object `AttentionList` hands back to
  // `renderAction`. A rolled-up row is a new object and finds nothing here,
  // which is the right answer: four proposed meetings cannot be settled with
  // one pair of buttons.
  const answerTo = new Map<Status, { id: string; status: string }>();
  // One derivation per meeting, shared by the attention row and the timeline
  // row below it, so the two can never describe the same meeting differently.
  const open = meetings.filter(interviewIsOpen).map((m) => ({
    meeting: m,
    status: meetingStatus(
      { id: m.id, status: m.status, scheduledAt: m.scheduledAt, sessionId: m.sessionId },
      viewer
    ),
  }));
  const meetingRows = open.flatMap(({ meeting: m, status: s }) => {
    if (!s || s.type !== "MEETING_AWAITING_ANSWER") return [];
    // Whose meeting it is: the status is voiced at the reader, so the only name
    // worth carrying is the other person's.
    const row: Status = {
      ...s,
      subject: {
        kind: "mentor",
        id: m.mentor.id,
        name: m.mentor.name ?? m.mentor.email,
      },
    };
    answerTo.set(row, { id: m.id, status: m.status });
    return [row];
  });

  // Every state each task is in, derived once and read two ways: the row's
  // chips want all of them, "Needs you" wants only the one a student can act
  // on. That one is dormant — `TASK_OVERDUE` wants a real due date, and
  // `Assignment.deadline` is still the free text the tracking sheet held
  // ("March-May") — and wired anyway, so splitting that column into `dueOn`
  // lights the row up instead of waiting for someone to remember this page.
  // Everything already delivered, newest first — the ledger's own order.
  const held = ledger.sessions;

  const tasks = ledger.assignments.map((task) => ({
    task,
    statuses: taskStatuses(
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
    ),
  }));
  const overdueTasks = tasks.flatMap((t) =>
    t.statuses.filter((s) => s.type === "TASK_OVERDUE")
  );

  // The product's worst dead end, from the student's side: they hold time with
  // someone and have no way to book it. One row per mentor, so the row names
  // who to chase; `rollUp` collapses them once there are more than three.
  const holdsTime = new Set(
    hours.perMentor.flatMap((m) => (m.mentor && m.remaining > 0 ? [m.mentor.id] : []))
  );
  // A mentor can be paired twice, once program-wide and once for the cohort, so
  // what matters is whether they have a link anywhere — not whether the row
  // this student's cohort matched happens to carry one.
  const linked = new Set(pairings.flatMap((p) => (p.calendlyUrl ? [p.mentorId] : [])));
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

  // Sessions their mentors logged that they have not spoken about yet. One
  // row each, capped by `attentionList`'s own roll-up once there are more than
  // three, and every one of them a link to the page that can answer it.
  const unconfirmed = held.flatMap((s) => {
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
  // `AttentionList` already says in this page's own words — and with an
  // informational row still on screen "Nothing needs you" would be contradicted
  // by the line directly under it.
  const needsYou = attentionList(
    [...mine, ...meetingRows, ...overdueTasks, ...bookingRows, ...unconfirmed],
    viewer
  ).filter((s) => s.type !== "ALL_CLEAR");

    const upNext: TimelineEntry[] = open.map(({ meeting: m, status }) => ({
    id: m.id,
    at: m.scheduledAt,
    hasTime: m.hasTime,
    // A meeting with no time yet is waiting on the mentor, not an all-day
    // event — the wording the section this replaced got right.
    timePending: !m.hasTime,
            // No title: the mentor's chip beside it in a section called "Up next" is
    // already the whole sentence.
    // The chip goes when the answer buttons are here: `InterviewResponse`
    // renders the chosen answer as the quieter of its two buttons, so a
    // "✓ You're confirmed" chip beside a "You're confirmed" button is the
    // same fact twice — the redundancy the section this replaced also had.
    // A meeting still awaiting an answer keeps its chip, because its buttons
    // are up in Needs you and the row would otherwise say nothing.
        status:
      bucketOf(m.scheduledAt, now) === "overdue" ||
      m.status === INTERVIEW_STATUS.PROPOSED
        ? status
        : undefined,
    person: m.mentor,
    joinUrl: m.link,
    note: m.note,
    // The answer lives with the meeting once it HAS an answer, because
    // changing your mind is not something that "needs you" — it is something
    // you go and do. `InterviewResponse` keeps both buttons live and quiets
    // the one already chosen, so a student who confirmed on Monday can still
    // say they cannot make Thursday. Putting the control only on the awaiting
    // row in Needs you removed that, and silence is not an answer.
    //
    // Never both places at once: an unanswered meeting is answered up in Needs
    // you, and this branch is the complement of that condition.
        // No answer on a row that cannot be answered: a meeting still awaiting one
    // is answered up in Needs you, and one whose day has gone is not a
    // question any more.
    action:
      m.status === INTERVIEW_STATUS.PROPOSED ||
      bucketOf(m.scheduledAt, now) === "overdue" ? undefined : (
        <InterviewResponse interviewId={m.id} status={m.status} />
      ),
  }));

  const finished = tasks.filter((t) => t.task.progress === ASSIGNMENT_PROGRESS.DONE);
  // In progress first, then not started: a plan reads forward.
  const live = [
    ...tasks.filter((t) => t.task.progress === ASSIGNMENT_PROGRESS.IN_PROGRESS),
    ...tasks.filter((t) => t.task.progress === ASSIGNMENT_PROGRESS.NOT_STARTED),
  ];

  return (
    <div className="space-y-6">
      <PageTitle
        eyebrow={
          enrollmentsLabel(profile.enrollments)
        }
        title={`Hi, ${user.name.split(" ")[0]}`}
        // Unconditional now: the only student who could not follow this link
        // was one awaiting approval, and /onboarding holds them before they
        // reach this page. A guard for a reader who cannot arrive reads like a
        // second, quieter rule about who may book.
        subtitle={<ArrowLink href="/student/book">Book a session</ArrowLink>}
        leading={
          // 96px, scaled from the component's own 132: a ring that size beside
          // the h1 on a 390px screen leaves the greeting three words wide, and
          // the figure inside it has to stay the ledger's own rather than being
          // re-derived by a second ring.
          <div className="h-24 w-24">
            <HoursRing
              used={hours.used}
              allotted={hours.allotted}
              forfeited={hours.forfeited}
              remaining={hours.remaining}
              className="origin-top-left scale-[0.727]"
            />
          </div>
        }
      />

      <AttentionList
        statuses={needsYou}
        feed={feed}
        empty="Nothing to do right now."
        renderAction={(s) => {
          const meeting = answerTo.get(s);
          // The only write on this page. A meeting is answered where it is
          // read, because "say whether you can make it" and a trip to another
          // page to say it are not the same request.
          return meeting ? (
            <InterviewResponse interviewId={meeting.id} status={meeting.status} />
          ) : null;
        }}
      />

            {/* Overdue is included, and it has to be: a meeting that happened
          yesterday and has not been written up yet was simply disappearing
          from a student's week. They can do nothing about it, so the row is
          informational and says whose move it is. */}
      <Timeline
        entries={upNext}
        now={now}
        buckets={["overdue", "today", "week"]}
        moreHref="/student/meetings"
        moreLabel="All meetings"
      />

      {(hours.allotted > 0 || hours.used > 0 || hours.extra > 0) && (
        <Section title="Your time">
          <div className="px-4 py-4 sm:px-5">
            <HoursBreakdown
              allotted={hours.allotted}
              completed={hours.completed}
              missed={hours.missed}
              forfeited={hours.forfeited}
              // Only ever the overdraw. What is left is the ring's job and the
              // grey tail of the bar shows the same proportion, so a "Still
              // yours" figure in the key would be the third statement of one
              // number that this page was reorganised to remove — but a bar
              // that cannot show an overdraw is a bar that lies about it.
              remaining={Math.min(0, hours.remaining)}
              extra={hours.extra}
            />
          </div>
        </Section>
      )}

      <Section title="Working on">
        {live.length === 0 && finished.length === 0 ? (
          <EmptyState framed={false} title="No tasks planned">
            Your team adds them with a time budget for each.
          </EmptyState>
        ) : (
          <>
            {live.length > 0 && (
              // Two up. A task card is a title, a chip or two and a bar — it
              // never fills a phone-width row, so one per line spent the whole
              // right-hand side on nothing and pushed the finished fold below
              // the fold of the screen.
              <ul className="grid sm:grid-cols-2">
                {live.map(({ task, statuses }) => (
                  <TaskRow key={task.id} task={task} statuses={statuses} />
                ))}
              </ul>
            )}
            {finished.length > 0 && (
              <div
                className={cn(
                  "px-4 py-2 sm:px-5",
                  live.length > 0 && "border-t border-line"
                )}
              >
                <Disclosure label="Finished" count={finished.length}>
                  <ul className="divide-y divide-line/60">
                    {finished.map(({ task }) => (
                      <FinishedTask key={task.id} task={task} />
                    ))}
                  </ul>
                </Disclosure>
              </div>
            )}
          </>
        )}
      </Section>

      {/* Their own history, folded. It moved to /student/meetings in the
          reorganisation and a student lost the ability to glance at what has
          happened without leaving home — but open by default it is the longest
          thing on the page and pushes everything that needs doing off screen.
          So: on the page, closed, counted. */}
      {held.length > 0 && (
        <Section title="Meetings you've had" count={held.length}>
          <div className="px-4 py-2 sm:px-5">
            <Disclosure
              label="Show them"
              aside={
                <Link
                  href="/student/meetings"
                  className="text-xs font-medium text-brand hover:underline"
                >
                  All meetings
                </Link>
              }
            >
              <ol className="divide-y divide-line/60">
                {toSessionEntries(held).map((session, i) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    viewer={viewer}
                    variant="timeline"
                    index={i}
                  />
                ))}
              </ol>
            </Disclosure>
          </div>
        </Section>
      )}

    </div>
  );
}
