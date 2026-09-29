import Link from "next/link";
import { redirect } from "next/navigation";

import { ExpandableText } from "@/components/expandable-text";
import { HoursBreakdown } from "@/components/hours-breakdown";
import { HoursRing } from "@/components/hours-ring";
import { PersonChip } from "@/components/person-chip";
import {
  StudentTaskRow,
  toStudentTaskEntries,
} from "@/components/student-task-row";
import { TaskProgressControl } from "@/components/forms/student-task-forms";
import { Disclosure } from "@/components/ui/disclosure";
import { SessionRow } from "@/components/session-row";
import { toSessionEntries } from "@/lib/session-entries";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLink } from "@/components/ui/link";
import { Meter } from "@/components/ui/meter";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusSummary } from "@/components/status-summary";
import { DeadlineText, StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/cn";
import { ASSIGNMENT_PROGRESS, ROLES, USER_STATUS } from "@/lib/constants";
import { withoutMentorNotes } from "@/lib/authz";
import { requireRole } from "@/lib/dal";
import { formatDate, formatDuration, formatMinutes } from "@/lib/format";
import { enrollmentsLabel } from "@/lib/enrollments";
import { allocationSummary } from "@/lib/hours";
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
function AgendaRow({ task, statuses }: { task: LedgerAssignment; statuses: Status[] }) {
  const budget = task.minuteLimit ?? 0;
  const over = budget > 0 && task.loggedMinutes > budget;

  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        {/* A purpose is occasionally written as a paragraph rather than a name,
            and one such row must not cost every other row its scanability. */}
        <div className="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug text-ink">
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

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
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
          <p className="mt-1.5 text-[0.8125rem] tabular-nums text-muted-fg">
            <span
              className={cn(
                "font-medium",
                over ? "text-danger-ink" : "text-ink",
              )}
            >
              {formatMinutes(task.loggedMinutes)}
            </span>
            {" "}of {formatMinutes(budget)}
          </p>
        </>
      ) : (
        task.loggedMinutes > 0 && (
          <p className="mt-1.5 text-[0.8125rem] text-muted-fg">
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
      <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-muted-fg">
        {task.purpose}
      </span>
      {task.mentor && <PersonChip person={task.mentor} size="sm" />}
      <span className="text-[0.8125rem] tabular-nums text-muted-fg">
        {formatMinutes(task.loggedMinutes)}
      </span>
    </li>
  );
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

  const [hours, ledger] = await Promise.all([
    allocationSummary(profile.id),
    studentLedger(profile.id),
  ]);

  // Everything already delivered, newest first — the ledger's own order.
  //
  // Minus the mentor's note, which this reader is the subject of rather than
  // the audience for. Stripped here, before anything renders: a row that
  // merely declines to print it would still ship it to the browser.
  const held = withoutMentorNotes(ledger.sessions);

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
  const account = await studentRows(user, profile, hours, ledger, now);
  // The soonest use-by, stated even outside the month the expiry row warns
  // in: a deadline is the one date on this page that costs time, and a
  // student should be able to see it before it becomes a warning.
  const useBy =
    hours.expiring && !account.some((s) => s.type === "ALLOCATION_EXPIRING")
      ? hours.expiring
      : null;

  // What their mentors set them to go away and do — already soonest-deadline
  // first from the query, because that is the order a to-do list is read in.
  const myTasks = toStudentTaskEntries(ledger.tasks, {
    showProgram: profile.enrollments.length > 1,
  });
  const openTasks = myTasks.filter(taskIsOpen);
  const doneTasks = myTasks.filter((t) => !taskIsOpen(t));

  return (
    <div className="space-y-4">
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
          // 96px rather than the component's own 132: a ring that size beside
          // the h1 on a 390px screen leaves the greeting three words wide. Sized
          // by its prop, not a scale transform, so the stroke and the figure are
          // sizes somebody chose rather than 73% of them.
          <HoursRing
            used={hours.used}
            allotted={hours.allotted}
            forfeited={hours.forfeited}
            remaining={hours.remaining}
            size={96}
          />
        }
      />

      {/* Account truth, between the greeting and the figures: a chip, and
          the sentence that goes with it, most urgent first. */}
      <StatusSummary statuses={account} title="Things to check" />

      {(hours.allotted > 0 || hours.used > 0 || hours.extra > 0) && (
        <Section title="Your time">
          <div className="px-4 py-3 sm:px-5">
            <HoursBreakdown
              allotted={hours.allotted}
              completed={hours.completed}
              missed={hours.missed}
              // Only ever the overdraw. What is left is the ring's job and the
              // unfilled tail of the track shows the same proportion, so a
              // "Still yours" figure in the key would be the third statement of
              // one number that this page was reorganised to remove — but a bar
              // that cannot show an overdraw is a bar that lies about it.
              remaining={Math.min(0, hours.remaining)}
            />
            {useBy && (
              <p className="mt-3 text-[0.8125rem] text-muted-fg">
                {formatDuration(useBy.minutes)} to use by{" "}
                <DeadlineText
                  deadline={useBy.date}
                  now={now}
                  within={EXPIRY_WINDOW_DAYS.student}
                />
              </p>
            )}
          </div>
        </Section>
      )}

      {/* The one section on this page that ASKS the student for something, so
          it leads everything except their balance. Each row carries its own
          control: a task is moved where it is read, never on a second screen
          behind an Edit. */}
      <Section
        eyebrow="Set by your mentor"
        title="Tasks"
        count={openTasks.length || undefined}
        // Only once there is something to count: "0 done" on a fresh list is a
        // figure that says nothing the empty list does not already say.
        caption={doneTasks.length > 0 ? `${doneTasks.length} done` : undefined}
      >
        {myTasks.length === 0 ? (
          <EmptyState framed={false} title="No tasks set">
            Your mentor gives you work to do between meetings.
          </EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {openTasks.map((task, i) => (
                <StudentTaskRow
                  key={task.id}
                  task={task}
                  viewer={viewer}
                  index={i}
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

      {/* What the mentoring HOURS are for, which is a different list from the
          one above and was called "Tasks" until both existed. Read-only: an
          admin plans it and the hours a mentor logs move it. */}
      <Section eyebrow="What your time is for" title="Agenda">
        {live.length === 0 && finished.length === 0 ? (
          <EmptyState framed={false} title="No agenda planned">
            Your team adds it with a time budget for each piece of work.
          </EmptyState>
        ) : (
          <>
            {live.length > 0 && (
              // One column, hairlines between — the grouped list every other
              // card on the page is. The two-up grid it replaces drew a
              // vertical rule down the card and left an empty half-cell
              // whenever the count was odd, which read as a table with a hole.
              <ul className="divide-y divide-line">
                {live.map(({ task, statuses }) => (
                  <AgendaRow key={task.id} task={task} statuses={statuses} />
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

      {/* Their own history, folded. It moved to /student/meetings in the
          reorganisation and a student lost the ability to glance at what has
          happened without leaving home — but open by default it is the longest
          thing on the page and pushes everything that needs doing off screen.
          So: on the page, closed, counted. */}
      {held.length > 0 && (
        <Section
          title="Meetings you've had"
          count={held.length}
          // The way to the full list sits beside the group's title, where iOS
          // puts a "See all", rather than wedged against the fold's own label.
          action={
            <Link
              href="/student/meetings"
              transitionTypes={["nav-forward"]}
              className="text-[0.9375rem] font-medium text-brand hover:text-brand-dark"
            >
              See all
            </Link>
          }
        >
          <div className="px-4 py-2 sm:px-5">
            <Disclosure label="Show them">
              <ol className="divide-y divide-line">
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
