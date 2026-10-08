import Link from "next/link";
import { redirect } from "next/navigation";

import { ExpandableText } from "@/components/expandable-text";
import { HoursBreakdown } from "@/components/hours-breakdown";
import { PersonChip } from "@/components/person-chip";
import {
  StudentTaskRow,
  toStudentTaskEntries,
} from "@/components/student-task-row";
import { TaskProgressControl } from "@/components/forms/student-task-forms";
import { Disclosure } from "@/components/ui/disclosure";
import { InterviewLogRow } from "@/components/interview-log-row";
import { SessionRow } from "@/components/session-row";
import { meetingCount, meetingLog, toSessionEntries } from "@/lib/session-entries";
import { interviewsForLog } from "@/lib/student-interviews";
import { ArrowLink } from "@/components/ui/link";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { readParam, type SearchParams } from "@/lib/filters";
import { ReportMentorButton } from "@/components/report-mentor-button";
import { Meter } from "@/components/ui/meter";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusSummary } from "@/components/status-summary";
import { DeadlineText, StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/cn";
import { ASSIGNMENT_PROGRESS, ROLES, USER_STATUS } from "@/lib/constants";
import { withoutMentorNotes } from "@/lib/authz";
import { requireRole } from "@/lib/dal";
import { formatDate, formatDuration, formatMinutes } from "@/lib/format";
import { allocationSummary, type AllocationSummary } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { studentRows } from "@/lib/attention";
import { studentLedger, type LedgerAssignment } from "@/lib/queries";
import { taskIsOpen } from "@/lib/student-tasks";
import {
  EXPIRY_WINDOW_DAYS,
  taskStatuses,
  type Status,
  type ViewerContext,
} from "@/lib/status";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Home" };

/**
 * One line of the AGENDA — a piece of work the student's hours were budgeted
 * for — in the student's own words.
 *
 * Not a task. A task is what a mentor sets them to go away and do, it is drawn
 * by `StudentTaskRow` above this on the page, and it is the only one of the two
 * the student can move. See `lib/student-tasks.ts` for why they are two things.
 *
 * Private to this page rather than shared: the same agenda item is a table row
 * with a ⋮ menu on a staff workspace (§6.7) and a read-only card here, and the
 * two have nothing in common but the noun. What they DO share — which states
 * are true of it, and what each is called — comes from `taskStatuses`, so the
 * two renderings can never disagree about what "in progress" means.
 */
function AgendaRow({
  task,
  statuses,
  hideMentor = false,
}: {
  task: LedgerAssignment;
  statuses: Status[];
  hideMentor?: boolean;
}) {
  const budget = task.minuteLimit ?? 0;
  const over = budget > 0 && task.loggedMinutes > budget;
  const overdue = statuses.some((s) => s.type === "TASK_OVERDUE");

  return (
    // The anchor "Things to check" links an overdue agenda item to; scroll-mt
    // so it lands under the phone's top bar rather than behind it.
    <li id={`agenda-${task.id}`} className="scroll-mt-20 px-4 py-3 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        {/* A purpose is occasionally written as a paragraph rather than a name,
            and one such row must not cost every other row its scanability. */}
        <div className="min-w-0 flex-1 text-body font-medium leading-snug text-ink">
          <ExpandableText text={task.purpose} lines={2} />
        </div>
        {/* Whichever half this task has. The note is free text — the tracking
            sheet holds both "Aug 7" and "March-May" — and carries no severity
            of its own; the row's own statuses say if it is overdue, which only
            a real dueOn can decide.
            Not beside an overdue chip: "Was due October 3" already names the
            day, and a grey "October 3" next to it was the same date twice. */}
        {!overdue && (task.dueNote ?? task.dueOn) && (
          <StatusChip severity="neutral" className="shrink-0">
            {task.dueNote ?? formatDate(task.dueOn!)}
          </StatusChip>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {task.mentor && !hideMentor && <PersonChip person={task.mentor} size="sm" />}
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
          <p className="mt-1.5 text-xs tabular-nums text-muted-fg">
            {/* "2h planned" rather than "0 min of 2h": the zero switched the
                list between two duration formats from one row to the next,
                and the "Not started" chip above already says nothing is
                logged. */}
            {task.loggedMinutes === 0 ? (
              <>{formatMinutes(budget)} planned</>
            ) : (
              <>
                <span
                  className={cn(
                    "font-medium",
                    over ? "text-danger-ink" : "text-ink",
                  )}
                >
                  {formatMinutes(task.loggedMinutes)}
                </span>
                {" "}of {formatMinutes(budget)}
              </>
            )}
          </p>
        </>
      ) : (
        task.loggedMinutes > 0 && (
          <p className="mt-1.5 text-xs text-muted-fg">
            <span className="font-medium tabular-nums text-ink">
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
function FinishedAgendaItem({ task }: { task: LedgerAssignment }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
      <span className="min-w-0 flex-1 truncate text-body text-muted-fg">
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
 * The balance, as the page's title, in the ledger's own word — Remaining, the
 * same word every reader's table uses for it. Said in words at both ends of
 * the range, because "0 min" read as "used it all" to a student whose time
 * had expired, and "-2h" read as a typo.
 */
function Balance({ hours }: { hours: AllocationSummary }) {
  if (hours.allotted === 0 && hours.used === 0) return <>No hours yet</>;
  if (hours.remaining < 0) return <>{formatDuration(-hours.remaining)} over</>;
  if (hours.remaining === 0) return <>No hours remaining</>;
  return <>{formatDuration(hours.remaining)} remaining</>;
}

/** An empty list that is ordinary rather than a problem: one quiet line. */
function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-3 text-xs text-muted-fg sm:px-5">{children}</p>
  );
}

/**
 * The first-run card: what a new student does here, in order, in three short
 * lines. It replaces two empty sections ("No tasks set", "No agenda planned")
 * that each took 145px to say there was nothing yet, and it goes away by
 * itself the first time anything happens on the account.
 */
function HowItWorks() {
  const steps = [
    {
      title: "Book a time with your mentor",
      body: "Pick a slot on their calendar from the Book tab.",
    },
    {
      title: "Meet and get to work",
      body: "After you meet, your mentor logs the session here and it comes off your hours.",
    },
    {
      title: "Keep going between meetings",
      body: "Tasks your mentor sets you show up on this page. Mark your progress as you go.",
    },
  ];
  return (
    <Section title="How it works">
      <ol className="divide-y divide-line">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-3 px-4 py-3 sm:px-5">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fill text-xs font-semibold text-ink"
            >
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-body font-medium text-ink">{step.title}</span>
              <span className="mt-0.5 block text-xs text-muted-fg">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="border-t border-line px-4 py-2 sm:px-5">
        <ArrowLink href="/student/book">Book your first session</ArrowLink>
      </div>
    </Section>
  );
}

/**
 * The account rows, minus the ones this page already says somewhere better.
 *
 * - An overdue task or agenda item is drawn in its own list, with its overdue
 *   chip, a few hundred pixels down. Repeated here it appeared two or three
 *   times on one screen ("Draft the activities section" under Things to check
 *   AND under Tasks, both "Was due September 29").
 * - The use-by row repeats the line under the balance, once that line shows.
 * - Mentors with no booking link are ONE row however many there are, and a
 *   neutral one: it is the mentor's setup step, not something the student did
 *   wrong, and two amber rows for it made five warnings on the first screen.
 */
function withoutRepeats(
  rows: Status[],
  { useByShown }: { useByShown: boolean }
): Status[] {
  const kept = rows.filter(
    (s) =>
      s.type !== "TASK_OVERDUE" &&
      !(useByShown && s.type === "ALLOCATION_EXPIRING")
  );
  const noLink = kept.filter((s) => s.type === "BOOKING_LINK_MISSING");
  if (noLink.length === 0) return kept;

  const names = noLink.flatMap((s) => (s.subject ? [s.subject.name] : []));
  const merged: Status = {
    ...noLink[0],
    severity: "neutral",
    label: "No booking link yet",
    explanation:
      noLink.length === 1
        ? "Email them to find a time instead."
        : "Email them to find a time instead — their addresses are on the Book tab.",
    subject: noLink[0].subject && {
      ...noLink[0].subject,
      name: listNames(names),
    },
    href: "/student/book",
  };
  const at = kept.indexOf(noLink[0]);
  const rest = kept.filter((s) => s.type !== "BOOKING_LINK_MISSING");
  return [...rest.slice(0, at), merged, ...rest.slice(at)];
}

/** "Sarvar", "Sarvar and Aziza", "Sarvar, Aziza and 2 others". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length === 3 ? "" : "s"}`;
}

/**
 * The student's home. Phone first, and that is the whole design.
 *
 * The question this page exists to answer — how much time have I left, what
 * needs doing, when am I meeting someone — used to be answered below the fold.
 * An orange gradient hero with a 120px ghost monogram opened it, the balance
 * was stated three times (ring, sentence, breakdown key), then two red
 * callouts, then thirteen unpaginated journey entries: on a 390×664 screen the
 * first thing that asked anything of the student sat past 900px. So the
 * balance IS the h1 ("14h left"), the greeting is its eyebrow, and everything
 * with a question in it is one section that begins under 300px. (It was a
 * 96px ring beside a "Hi, Malika" h1: the ring's figure was 19px, the
 * smallest number a student opens the app to read.)
 *
 * Nothing here writes a status's wording or picks its colour. Every row's words
 * come from `lib/status.ts` in the student's own voice, which is what makes a
 * meeting read "Needs your answer" instead of "Awaiting Aziza's answer", and
 * what keeps this page and the mentor's inbox from inventing two vocabularies
 * for the same fact.
 */
/** Meetings on a page of Home; the rest are one numbered tap away. */
const HOME_MEETINGS = 3;

export default async function StudentHomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireRole(ROLES.STUDENT);
  const query = await searchParams;
  const meetingsPage = parsePage(readParam(query, "meetings"));
  const now = new Date();
  const viewer: ViewerContext = { audience: "student", userId: user.id, now };

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    include: { enrollments: { include: { program: true, cohort: true, level: true } } },
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

  const [hours, ledger, interviews] = await Promise.all([
    allocationSummary(profile.id),
    studentLedger(profile.id),
    interviewsForLog(profile.id, now),
  ]);

  // Everything already delivered, newest first — the ledger's own order.
  //
  // Minus the mentor's note, which this reader is the subject of rather than
  // the audience for. Stripped here, before anything renders: a row that
  // merely declines to print it would still ship it to the browser.
  const held = withoutMentorNotes(ledger.sessions);
  // Practice interviews read in the same history, but are not sessions: they
  // spend no allocation and nothing on this page adds them to an hour figure.
  const log = meetingLog(held, interviews);
  const oneMentorMet = new Set(held.map((h) => h.mentor.id)).size <= 1;

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
  const finished = tasks.filter((t) => t.task.progress === ASSIGNMENT_PROGRESS.DONE);
  // In progress first, then not started: a plan reads forward.
  const live = [
    ...tasks.filter((t) => t.task.progress === ASSIGNMENT_PROGRESS.IN_PROGRESS),
    ...tasks.filter((t) => t.task.progress === ASSIGNMENT_PROGRESS.NOT_STARTED),
  ];

  // What is true of the ACCOUNT, said to its owner — the same rows the bell
  // lists on /notifications: no time, no mentor, a deadline coming or one
  // that ate a balance, a mentor with no booking link, meetings to confirm,
  // overdue work. A student with nothing yet used to land on a 0m ring and
  // three empty sections and be told nothing. The balance and the ledger are
  // handed over rather than read again.
  const rows = await studentRows(user, profile, hours, ledger, now);
  // The soonest use-by now sits under the balance it applies to, always —
  // so the "8h expires October 17" row would say it a second time.
  const useBy = hours.expiring;
  const account = withoutRepeats(rows, { useByShown: useBy != null });

  const first = user.name.split(" ")[0];

  // What their mentors set them to go away and do — already soonest-deadline
  // first from the query, because that is the order a to-do list is read in.
  const myTasks = toStudentTaskEntries(ledger.tasks, {
    showProgram: profile.enrollments.length > 1,
  });
  // One mentor across everything: their name on every task and agenda row was
  // the same chip repeated down the page.
  const oneMentor =
    new Set([
      ...myTasks.map((t) => t.mentor.id),
      ...ledger.assignments.map((a) => a.mentorId),
    ]).size <= 1;
  const openTasks = myTasks.filter(taskIsOpen);
  const doneTasks = myTasks.filter((t) => !taskIsOpen(t));

  // Nothing has happened on this account yet: no time spent, no meeting, no
  // task and no plan. Three empty sections in a row told a new student three
  // times that nothing was there and never once what to do first.
  const firstRun =
    hours.used === 0 &&
    held.length === 0 &&
    myTasks.length === 0 &&
    tasks.length === 0;

  return (
    <div className="space-y-4">
      <PageTitle
        // The greeting steps down to the eyebrow, and the balance becomes the
        // title. It was "Hi, Malika" at 32px beside a 19px figure in a ring:
        // the friendliest words on the page were also its loudest, and the one
        // number a student opens the app for was a badge beside them.
        // The program is on Settings and in every ledger row; here it was a third
        // thing to read before the one number.
        eyebrow={`Hi, ${first}`}
        title={<Balance hours={hours} />}
        // The one big button on the page, in the corner under the profile
        // picture (October 2026, at the owner's ask) — half the width it was
        // when it ran the full column under the greeting.
        actions={<ReportMentorButton />}
        subtitle={
          <span className="flex flex-col items-start gap-1">
            {useBy && (
              <span>
                {/* "4h 15m to use by…" under "4h 15m remaining" said the number
                    twice; the amount is only worth stating when it is part of
                    the balance, not all of it. */}
                {useBy.minutes === hours.remaining
                  ? "Use by "
                  : `${formatDuration(useBy.minutes)} to use by `}
                <DeadlineText
                  deadline={useBy.date}
                  now={now}
                  within={EXPIRY_WINDOW_DAYS.student}
                />
              </span>
            )}
            {hours.forfeited > 0 && (
              // Said in words, in red: time that expired unused is gone, and
              // a balance of "No time left" alone read as if it had been used.
              <span className="text-danger-ink">
                {formatDuration(hours.forfeited)} expired unused
              </span>
            )}
            <ArrowLink href="/student/book">Book a session</ArrowLink>
          </span>
        }
      />

      {/* Account truth, between the balance and the work: a chip, and the
          sentence that goes with it, most urgent first. */}
      <StatusSummary statuses={account} title="Things to check" />

      {firstRun && <HowItWorks />}

      {/* Only once something has been spent. Before that the bar was empty,
          "Total 10h" repeated the title and the use-by repeated the line
          under it — the same number three times on a new student's home. */}
      {hours.used > 0 && (
        <Section title="Your time">
          <div className="px-4 py-3 sm:px-5">
            <HoursBreakdown
              allotted={hours.allotted}
              completed={hours.completed}
              missed={hours.missed}
              // Only ever the overdraw. What is left is the title's job and the
              // unfilled tail of the track shows the same proportion — but a
              // bar that cannot show an overdraw is a bar that lies about it.
              remaining={Math.min(0, hours.remaining)}
              // Lost time drawn as lost, in red, rather than as the same grey
              // as time still to use.
              expired={hours.forfeited}
            />
          </div>
        </Section>
      )}

      {/* The one section on this page that ASKS the student for something, so
          it leads everything except their balance. Each row carries its own
          control: a task is moved where it is read, never on a second screen
          behind an Edit. */}
      {!firstRun && (
      <Section
        title="Tasks"
        count={openTasks.length || undefined}
      >
        {myTasks.length === 0 ? (
          // One line, not a 145px empty state with an icon: an empty list
          // here is ordinary, and it should not outweigh the lists that have
          // something in them.
          <EmptyLine>No tasks right now.</EmptyLine>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {openTasks.map((task, i) => (
                <StudentTaskRow
                  key={task.id}
                  task={task}
                  viewer={viewer}
                  index={i}
                  hideMentor={oneMentor}
                  footer={
                    <TaskProgressControl
                      taskId={task.id}
                      percent={task.percent}
                      done={false}
                    />
                  }
                />
              ))}
            </ul>
            {doneTasks.length > 0 && (
              <div
                className={cn(
                  "px-4 py-2 sm:px-5",
                  openTasks.length > 0 && "border-t border-line"
                )}
              >
                {/* Finished, folded: it has stopped asking anything, and the
                    way back out of a mistake is inside the fold with it. */}
                <Disclosure label="Finished" count={doneTasks.length}>
                  <ul className="-mx-4 divide-y divide-line sm:-mx-5">
                    {doneTasks.map((task) => (
                      <StudentTaskRow
                        key={task.id}
                        task={task}
                        viewer={viewer}
                        hideMentor={oneMentor}
                        footer={
                          <TaskProgressControl
                            taskId={task.id}
                            percent={task.percent}
                            done
                          />
                        }
                      />
                    ))}
                  </ul>
                </Disclosure>
              </div>
            )}
          </>
        )}
      </Section>
      )}

      {/* What the mentoring HOURS are for, which is a different list from the
          one above and was called "Tasks" until both existed. Read-only: an
          admin plans it and the hours a mentor logs move it. */}
      {!firstRun && (
      <Section title="Agenda">
        {live.length === 0 && finished.length === 0 ? (
          <EmptyLine>Nothing planned yet.</EmptyLine>
        ) : (
          <>
            {live.length > 0 && (
              // One column, hairlines between — the grouped list every other
              // card on the page is. The two-up grid it replaces drew a
              // vertical rule down the card and left an empty half-cell
              // whenever the count was odd, which read as a table with a hole.
              <ul className="divide-y divide-line">
                {live.map(({ task, statuses }) => (
                  <AgendaRow key={task.id} task={task} statuses={statuses} hideMentor={oneMentor} />
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
                  <ul className="divide-y divide-line">
                    {finished.map(({ task }) => (
                      <FinishedAgendaItem key={task.id} task={task} />
                    ))}
                  </ul>
                </Disclosure>
              </div>
            )}
          </>
        )}
      </Section>
      )}

      {/* Their own history, folded. It moved to /student/meetings in the
          reorganisation and a student lost the ability to glance at what has
          happened without leaving home — but open by default it is the longest
          thing on the page and pushes everything that needs doing off screen.
          So: on the page, closed, counted. */}
      {log.length > 0 && (
        <Section
          title="Meetings"
          count={
            meetingCount(held) +
            interviews.filter((i) => i.phase === "completed").length
          }
          action={
            // 44px tall: at its text height it was an 18px target.
            <Link
              href="/student/meetings"
              transitionTypes={["nav-forward"]}
              className="inline-flex min-h-11 items-center text-body font-medium text-brand hover:text-brand-dark"
            >
              See all
            </Link>
          }
        >
          {/* The latest three, in view. They were folded behind "Show them":
              a list that exists to be glanced at, hidden behind a tap, and
              then — opened — as long as the page. The rest, numbered, are on
              the Meetings page. */}
          <ol className="divide-y divide-line px-4 sm:px-5">
            {log
              .slice((meetingsPage - 1) * HOME_MEETINGS, meetingsPage * HOME_MEETINGS)
              .map((item, i) =>
                item.kind === "interview" ? (
                  <InterviewLogRow
                    key={`interview-${item.interview.id}`}
                    interview={item.interview}
                    viewer={viewer}
                    index={i}
                  />
                ) : (
                  <SessionRow
                    key={item.session.id}
                    session={toSessionEntries([item.session])[0]}
                    viewer={viewer}
                    variant="timeline"
                    index={i}
                    // Said once, under "Things to check", not again here.
                    omit={["SESSION_UNCONFIRMED"]}
                    hideMentor={oneMentorMet}
                  />
                )
              )}
          </ol>
          {log.length > HOME_MEETINGS && (
            <Pagination
              basePath="/student"
              params={query}
              page={meetingsPage}
              pageSize={HOME_MEETINGS}
              total={log.length}
              unit="meetings"
              param="meetings"
              compact
              className="justify-center border-t border-line px-4 py-3 sm:px-5"
            />
          )}
        </Section>
      )}

    </div>
  );
}
