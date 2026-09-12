import { ExpandableText } from "@/components/expandable-text";
import { HoursBreakdown } from "@/components/hours-breakdown";
import { CalendarIcon, LinkIcon } from "@/components/icons";
import { PersonChip } from "@/components/person-chip";
import { SessionRow, toSessionEntries } from "@/components/session-row";
import { TaskRow, toTaskEntries } from "@/components/task-row";
import { Section } from "@/components/ui/section";
import {
  ASSIGNMENT_PROGRESS,
  SESSION_STATUS,
} from "@/lib/constants";
import {
  formatDuration,
  formatMeetingWhen,
  formatUntil,
} from "@/lib/format";
import { splitMeetings, type ScheduledMeeting } from "@/lib/interviews";
import type { LedgerAssignment, LedgerSession } from "@/lib/queries";
import { meetingStatus, type ViewerContext } from "@/lib/status";
import { ExternalLink } from "@/components/ui/link";
import { StatusChip } from "@/components/ui/status-chip";

/**
 * The tracking spreadsheet's whole tab on one screen: what happened on the left,
 * what was planned on the right, and the balance that ties them together across
 * the top. That side-by-side is the thing the sheet did that stacked panels
 * don't — the team reads a student by holding both halves at once, checking
 * delivered work against the plan it was supposed to deliver.
 *
 * Read-only on purpose. This is the view you open the page for; the panels
 * below it are the workbench where rows get corrected, and keeping the
 * management controls out of here is what lets it stay this dense.
 *
 * Both columns split the same way, because it is the same question twice: what
 * is still ahead of us, and what is behind. Ahead is violet and carries a date
 * you can act on; behind is quieter, in the amber the log has always used.
 */

/** A column heading inside the board — smaller than a panel's, same grammar. */
function ColumnHead({
  eyebrow,
  title,
  caption,
}: {
  eyebrow: string;
  title: string;
  caption: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 pb-2.5 pt-4 sm:px-5">
      <div>
        <div className="text-[0.625rem] font-bold uppercase tracking-[0.09em] text-muted-fg">
          {eyebrow}
        </div>
        <h3 className="mt-0.5 text-[0.9375rem] font-bold tracking-tight text-ink">
          {title}
        </h3>
      </div>
      <span className="text-xs tabular-nums text-muted-fg">{caption}</span>
    </div>
  );
}

/**
 * The rule between "still ahead" and "already behind". A label rather than a
 * plain divider: without it the two groups are just rows that happen to be in a
 * different order, which is exactly the confusion the sheet had.
 */
function GroupRule({ label, count }: { label: string; count: number }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-2.5 bg-canvas/60 px-4 py-1.5 sm:px-5">
      <span className="text-[0.625rem] font-bold uppercase tracking-[0.09em] text-muted-fg">
        {label}
      </span>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      <span className="text-[0.625rem] font-semibold tabular-nums text-muted-fg">
        {count}
      </span>
    </div>
  );
}

function UpcomingMeetingRow({
  meeting,
  viewer,
}: {
  meeting: ScheduledMeeting;
  viewer: ViewerContext;
}) {
  const state = meetingStatus(
    {
      id: meeting.id,
      status: meeting.status,
      scheduledAt: meeting.scheduledAt,
      sessionId: meeting.sessionId,
    },
    viewer
  );
  return (
    <li className="flex gap-3 px-4 py-2.5 sm:px-5">
      <span
        aria-hidden="true"
        className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-canvas text-muted-fg"
      >
        <CalendarIcon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[0.8125rem] font-semibold text-ink">
            {formatMeetingWhen(meeting.scheduledAt, meeting.hasTime)}
          </span>
          <span className="text-xs text-muted-fg">
            {formatUntil(meeting.scheduledAt)}
          </span>
          <PersonChip person={meeting.mentor} size="sm" />
          {state && <StatusChip status={state} />}
        </div>
        {meeting.note && (
          <div className="mt-0.5 text-[0.8125rem]">
            <ExpandableText text={meeting.note} lines={2} />
          </div>
        )}
        {meeting.link && (
          <ExternalLink
            href={meeting.link}
            icon={<LinkIcon className="h-3 w-3" />}
            className="mt-0.5 text-xs"
          >
            Meeting link
          </ExternalLink>
        )}
      </div>
    </li>
  );
}

export function LedgerBoard({
  sessions,
  meetings,
  assignments,
  totals,
  mentorBase,
  renderSessionActions,
  renderTaskActions,
  viewer,
}: {
  sessions: LedgerSession[];
  meetings: ScheduledMeeting[];
  assignments: LedgerAssignment[];
  totals: {
    allotted: number;
    completed: number;
    missed: number;
    forfeited: number;
    remaining: number;
    extra: number;
  };
  mentorBase?: string;
  /**
   * The ⋮ menus, resolved by the page for this reader.
   *
   * Both were missing, and their absence was the same bug twice: the board is
   * where a student's sessions and tasks are actually READ, and neither could
   * be corrected from it. A logged session had to be found again on /sessions;
   * a task could not be corrected anywhere at all, because `TaskRowActions`
   * and `TaskTable` were written, exported, and never rendered by anything.
   *
   * Functions rather than booleans, because whether a row has a menu is a
   * question about that row and its reader — a mentor gets one on the sessions
   * they logged and the tasks they own, an admin on everything in their
   * programs — and the page is the only thing holding the answer.
   */
  renderSessionActions?: (session: LedgerSession) => React.ReactNode;
  renderTaskActions?: (task: LedgerAssignment) => React.ReactNode;
  /** One instant for the whole board, so its two columns cannot disagree. */
  viewer: ViewerContext;
}) {
  const { upcoming, overdue } = splitMeetings(meetings, viewer.now);
  const ahead = [...upcoming, ...overdue];
  const logged = sessions;
  const activeCount = sessions.filter(
    (s) => s.status === SESSION_STATUS.ACTIVE,
  ).length;

  const open = assignments.filter(
    (a) => a.progress !== ASSIGNMENT_PROGRESS.DONE,
  );
  const finished = assignments.filter(
    (a) => a.progress === ASSIGNMENT_PROGRESS.DONE,
  );

  return (
    <Section
        eyebrow="At a glance"
        title="Meetings and plan"
        caption={`${activeCount} logged · ${ahead.length} scheduled · ${open.length} of ${assignments.length} tasks open`}
      >

      {/* The sheet's right-hand totals, given the width they deserve. */}
      <div className="border-b border-line px-4 py-2 sm:px-5">
        <HoursBreakdown
          allotted={totals.allotted}
          completed={totals.completed}
          missed={totals.missed}
          forfeited={totals.forfeited}
          remaining={totals.remaining}
          extra={totals.extra}
        />
      </div>

      <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-line">
        {/* LEFT — what happened, and what is about to */}
        <div className="min-w-0 border-b border-line lg:border-b-0">
          <ColumnHead
            eyebrow="Logged by mentors"
            title="Meetings"
            caption={
              activeCount === 0 && ahead.length === 0
                ? "Nothing planned"
                : `${formatDuration(totals.completed)} completed`
            }
          />
          {ahead.length === 0 && logged.length === 0 ? (
            <p className="px-4 pb-5 text-sm text-muted-fg sm:px-5">
              No meetings yet, scheduled or held.
            </p>
          ) : (
            <>
              <GroupRule label="Still to come" count={ahead.length} />
              <ul className="divide-y divide-line/50">
                {ahead.map((m) => (
                  <UpcomingMeetingRow key={m.id} meeting={m} viewer={viewer} />
                ))}
              </ul>
              <GroupRule label="Already held" count={logged.length} />
              <ul className="divide-y divide-line/50">
                {toSessionEntries(logged, { mentorBase }).map((s, i) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    viewer={viewer}
                    variant="timeline"
                    index={i}
                    actions={renderSessionActions?.(logged[i])}
                  />
                ))}
              </ul>
            </>
          )}
        </div>

        {/* RIGHT — what the time is for */}
        <div className="min-w-0">
          <ColumnHead
            eyebrow="Planned by an admin"
            title="Tasks"
            caption={
              assignments.length === 0
                ? "Nothing planned"
                : `${formatDuration(assignments.reduce((sum, a) => sum + (a.minuteLimit ?? 0), 0))} budgeted`
            }
          />
          {assignments.length === 0 ? (
            <p className="px-4 pb-5 text-sm text-muted-fg sm:px-5">
              No tasks yet — they arrive with the time an admin allocates.
            </p>
          ) : (
            <>
              <GroupRule label="In flight" count={open.length} />
              <ul className="divide-y divide-line/50">
                {toTaskEntries(open, { mentorBase }).map((t, i) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    viewer={viewer}
                    variant="list"
                    index={i}
                    actions={renderTaskActions?.(open[i])}
                  />
                ))}
              </ul>
              <GroupRule label="Finished" count={finished.length} />
              {/* Finished work is one line each: it is here to be counted and
                  to be findable, not to be read again. */}
              <ul className="divide-y divide-line/50">
                {toTaskEntries(finished, { mentorBase }).map((t, i) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    viewer={viewer}
                    variant="line"
                    actions={renderTaskActions?.(finished[i])}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </Section>
  );
}
