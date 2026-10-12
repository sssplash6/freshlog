import { redirect } from "next/navigation";

import { HoursBreakdown } from "@/components/hours-breakdown";
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
import { ReportMentorButton } from "@/components/report-mentor-button";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusSummary } from "@/components/status-summary";
import { DeadlineText } from "@/components/ui/status-chip";
import { cn } from "@/lib/cn";
import { ROLES, USER_STATUS } from "@/lib/constants";
import { withoutMentorNotes } from "@/lib/authz";
import { requireRole } from "@/lib/dal";
import { formatDuration } from "@/lib/format";
import { allocationSummary, type AllocationSummary } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { profileOf } from "@/lib/profile";
import { spaceOf } from "@/lib/space";
import { studentRows } from "@/lib/attention";
import { studentLedger } from "@/lib/queries";
import { taskIsOpen } from "@/lib/student-tasks";
import {
  EXPIRY_WINDOW_DAYS,
  type Status,
  type ViewerContext,
} from "@/lib/status";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Home" };

/**
 * The balance, as the page's title, in the ledger's own word — Remaining, the
 * same word every reader's table uses for it. Said in words at both ends of
 * the range, because "0 min" read as "used it all" to a student whose time
 * had expired, and "-2h" read as a typo.
 */
function Balance({ hours }: { hours: AllocationSummary }) {
  if (hours.allotted === 0 && hours.used === 0) return <>No hours yet</>;
  if (hours.remaining < 0) return <>{formatDuration(-hours.remaining)} overdrawn</>;
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
 * The account rows, minus the ones this page already says somewhere better.
 *
 * - An overdue task is drawn in its own list, with its overdue chip, a few
 *   hundred pixels down. Repeated here it appeared two or three times on one
 *   screen ("Draft the activities section" under Things to check AND under
 *   Tasks, both "Was due September 29"). An overdue agenda item has no list
 *   here any more, so it stays, without the link to a row that is gone.
 * - The use-by row repeats the line under the balance, once that line shows.
 * - Mentors with no booking link are ONE row however many there are, and a
 *   neutral one: it is the mentor's setup step, not something the student did
 *   wrong, and two amber rows for it made five warnings on the first screen.
 */
function withoutRepeats(
  rows: Status[],
  { useByShown }: { useByShown: boolean }
): Status[] {
  const kept = rows
    .filter(
      (s) =>
        !(s.type === "TASK_OVERDUE" && s.href?.startsWith("#student-task-")) &&
        !(useByShown && s.type === "ALLOCATION_EXPIRING")
    )
    .map((s) =>
      s.href?.startsWith("#agenda-") ? { ...s, href: undefined } : s
    );
  const noLink = kept.filter((s) => s.type === "BOOKING_LINK_MISSING");
  if (noLink.length === 0) return kept;

  const names = noLink.flatMap((s) => (s.subject ? [s.subject.name] : []));
  const merged: Status = {
    ...noLink[0],
    severity: "neutral",
    label: "No booking link yet",
    explanation: undefined,
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
 * balance IS the h1 ("14h left"), and everything with a question in it is one
 * section that begins under 300px.
 *
 * Nothing here writes a status's wording or picks its colour. Every row's words
 * come from `lib/status.ts` in the student's own voice, which is what makes a
 * meeting read "Needs your answer" instead of "Awaiting Aziza's answer", and
 * what keeps this page and the mentor's inbox from inventing two vocabularies
 * for the same fact.
 */
/** Meetings on Home; the rest are on the Meetings page. */
const HOME_MEETINGS = 3;

export default async function StudentHomePage() {
  const user = await requireRole(ROLES.STUDENT);
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

  const [hours, ledger, interviews, space] = await Promise.all([
    allocationSummary(profile.id),
    studentLedger(profile.id),
    interviewsForLog(profile.id, now),
    // The frame the shell already drew, asked again for free (request-cached).
    profileOf(user).then((lens) => spaceOf(user, lens)),
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

  // Where they stand in the institute, when they study in one: its top bar
  // already names the program, so the level and cohort are the part of "where
  // am I" nothing else on the page says. Their own membership, never a visit —
  // the same rule that put them in the frame.
  const standing =
    space.kind === "institute"
      ? profile.enrollments.find(
          (e) => e.programId === space.programId && !e.exchangeId
        )
      : undefined;
  const standingLabel = standing
    ? [standing.level?.name, standing.cohort?.name].filter(Boolean).join(" · ")
    : "";

  // What their mentors set them to go away and do — already soonest-deadline
  // first from the query, because that is the order a to-do list is read in.
  const myTasks = toStudentTaskEntries(ledger.tasks, {
    showProgram: profile.enrollments.length > 1,
  });
  // One mentor across every task: their name on every row was the same chip
  // repeated down the page.
  const oneMentor = new Set(myTasks.map((t) => t.mentor.id)).size <= 1;
  const openTasks = myTasks.filter(taskIsOpen);
  const doneTasks = myTasks.filter((t) => !taskIsOpen(t));

  // Nothing has happened on this account yet: no time spent, no meeting and no
  // task. An empty Tasks section would only say so.
  const firstRun =
    hours.used === 0 &&
    held.length === 0 &&
    myTasks.length === 0;

  return (
    <div className="space-y-4">
      <PageTitle
        // The balance is the title. The program is on Settings and in every
        // ledger row; in an institute the level and cohort sit above it
        // (owner decision 7).
        eyebrow={standingLabel || undefined}
        title={<Balance hours={hours} />}
        // The one big button on the page, in the corner under the profile
        // picture (October 2026, at the owner's ask) — half the width it was
        // when it ran the full column under the greeting.
        actions={<ReportMentorButton />}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-4">
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
            <ArrowLink href="/student/book">Book a meeting</ArrowLink>
          </span>
        }
      />

      {/* Account truth, between the balance and the work: a chip, and the
          sentence that goes with it, most urgent first. */}
      <StatusSummary statuses={account} />

      {/* Only once something has been spent or has expired. Before that the
          bar was empty and every figure repeated the title. Expired time is
          said here, in red, and nowhere else on the page. */}
      {(hours.used > 0 || hours.forfeited > 0) && (
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
              showTotal={false}
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

      {/* Their own history: the latest few, so a student can glance at what
          has happened without leaving home. */}
      {log.length > 0 && (
        <Section
          title="Meetings"
          count={
            meetingCount(held) +
            interviews.filter((i) => i.phase === "completed").length
          }
          action={<ArrowLink href="/student/meetings">See all</ArrowLink>}
        >
          {/* The latest three, in view; the rest are on the Meetings page. */}
          <ol className="divide-y divide-line px-4 sm:px-5">
            {log
              .slice(0, HOME_MEETINGS)
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
        </Section>
      )}

    </div>
  );
}
