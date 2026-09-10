import Link from "next/link";
import { redirect } from "next/navigation";

import { ExpandableText } from "@/components/expandable-text";
import { HoursBreakdown } from "@/components/hours-breakdown";
import { HoursRing } from "@/components/hours-ring";
import { PersonChip } from "@/components/person-chip";
import { Disclosure } from "@/components/ui/disclosure";
import { SessionRow, toSessionEntries } from "@/components/session-row";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLink } from "@/components/ui/link";
import { Meter } from "@/components/ui/meter";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/cn";
import { ASSIGNMENT_PROGRESS, ROLES, USER_STATUS } from "@/lib/constants";
import { requireRole } from "@/lib/dal";
import { formatDate, formatMinutes } from "@/lib/format";
import { enrollmentsLabel } from "@/lib/enrollments";
import { allocationSummary } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { studentLedger, type LedgerAssignment } from "@/lib/queries";
import { taskStatuses, type Status, type ViewerContext } from "@/lib/status";

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
