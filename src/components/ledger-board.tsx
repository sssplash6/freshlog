import { ExpandableText } from "@/components/expandable-text";
import { HoursBreakdown } from "@/components/hours-breakdown";
import { CalendarIcon, LinkIcon } from "@/components/icons";
import { PersonChip } from "@/components/person-chip";
import { SessionRow, toSessionEntries } from "@/components/session-row";
import {
  StudentTaskRow,
  type StudentTaskEntry,
} from "@/components/student-task-row";
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
import { taskIsOpen } from "@/lib/student-tasks";
import { meetingStatus, type ViewerContext } from "@/lib/status";
import { ExternalLink } from "@/components/ui/link";
import { StatusChip } from "@/components/ui/status-chip";

/**
 * The tracking spreadsheet's whole tab on one screen, in the shape the week
 * actually has: what happened, what the student is doing about it, and what the
 * hours were budgeted for.
 *
 *   Meetings   left, top     what mentors logged, and what is in the diary
 *   Tasks      right, top    what a mentor set the student to go away and DO
 *   Agenda     below, wide   what an admin planned the hours FOR
 *
 * The two on top are the week: the meeting that happened and the work it sent
 * the student away with, side by side, which is the pairing the team reads a
 * student by. The agenda is the term — it moves at the pace of a grant rather
 * than of a Tuesday — so it sits under both at full width, where its budget
 * bars have the room they need and where it stops competing for the eye with
 * the two lists that change every week.
 *
 * Tasks took the agenda's old place in the right-hand column, and the agenda
 * took the name "Agenda": two things called "Tasks" on one screen is the
 * confusion the rename exists to remove (`lib/student-tasks.ts` says which is
 * which).
 *
 * EACH PANE SCROLLS ITSELF. The three lists grow at wildly different rates — a
 * student two terms in has thirty meetings, six agenda items and a dozen tasks
 * — and on one page scroll the longest of them decided how far the reader had
 * to travel to see the other two at all. The screenshot that started this had
 * fourteen sessions down the left and a two-line Tasks column stranded beside
 * them. So each list gets its own viewport and its own scrollbar, and the board
 * stays the height of a screen however long any one of them gets: the whole log
 * is there, and reaching the bottom of it never costs you the other two.
 *
 * `max-h-[60svh]`, not `vh`: mobile browsers shrink the visible viewport when
 * the URL bar is showing, and `vh` panes are what leave a phone reader scrolling
 * a pane inside a page that is also scrolling.
 *
 * Read-only apart from the row menus and the one form that adds to it. This is
 * the view you open the page for; the panels below it are the workbench.
 */

/**
 * One pane's scrolling body. A column heading and the form under it stay put;
 * only the rows move, or a reader scrolling a long log loses the heading that
 * says which log it is.
 */
const PANE = "max-h-[60svh] overflow-y-auto overscroll-contain";

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
 *
 * Sticky inside its pane, and opaque rather than the 60% tint it was: now that
 * each list scrolls on its own, a reader forty rows into "Already held" would
 * otherwise have nothing on screen saying which group they are in — and a
 * translucent bar with rows sliding under it says it illegibly.
 */
function GroupRule({ label, count }: { label: string; count: number }) {
  if (count === 0) return null;
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2.5 bg-canvas px-4 py-1.5 sm:px-5">
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
  tasks,
  assignments,
  totals,
  mentorBase,
  renderSessionActions,
  renderTaskActions,
  renderAgendaActions,
  taskForm,
  viewer,
}: {
  sessions: LedgerSession[];
  meetings: ScheduledMeeting[];
  /** Work a mentor set the student — the top-right column. */
  tasks: StudentTaskEntry[];
  /** The hour plan an admin budgeted — the full-width block below. */
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
   * where a student's sessions and agenda are actually READ, and neither could
   * be corrected from it. A logged session had to be found again on /sessions;
   * an agenda item could not be corrected anywhere at all, because
   * `TaskRowActions` and `TaskTable` were written, exported, and never rendered
   * by anything.
   *
   * Functions rather than booleans, because whether a row has a menu is a
   * question about that row and its reader — a mentor gets one on the sessions
   * they logged and the work they own, an admin on everything in their
   * programs — and the page is the only thing holding the answer.
   */
  renderSessionActions?: (session: LedgerSession) => React.ReactNode;
  renderTaskActions?: (task: StudentTaskEntry) => React.ReactNode;
  renderAgendaActions?: (task: LedgerAssignment) => React.ReactNode;
  /** "Set a task", for a reader entitled to add one. */
  taskForm?: React.ReactNode;
  /** One instant for the whole board, so its columns cannot disagree. */
  viewer: ViewerContext;
}) {
  const { upcoming, overdue } = splitMeetings(meetings, viewer.now);
  const ahead = [...upcoming, ...overdue];
  const logged = sessions;
  const activeCount = sessions.filter(
    (s) => s.status === SESSION_STATUS.ACTIVE,
  ).length;

  const openTasks = tasks.filter(taskIsOpen);
  const doneTasks = tasks.filter((t) => !taskIsOpen(t));

  const planned = assignments.filter(
    (a) => a.progress !== ASSIGNMENT_PROGRESS.DONE,
  );
  const finished = assignments.filter(
    (a) => a.progress === ASSIGNMENT_PROGRESS.DONE,
  );

  return (
    <Section
      eyebrow="At a glance"
      title="Meetings, tasks and agenda"
      caption={`${activeCount} logged · ${ahead.length} scheduled · ${openTasks.length} of ${tasks.length} tasks open`}
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
            <div className={PANE}>
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
            </div>
          )}
        </div>

        {/* RIGHT — what the student is doing between meetings.
            `relative` so the "+" can pin itself to this column's own corner. */}
        <div className="relative min-w-0">
          <ColumnHead
            eyebrow="Set by a mentor"
            title="Tasks"
            // The whole log's shape, not just what is left: a mentor opening
            // somebody they have not seen in a month wants to know what was
            // finished as much as what is outstanding.
            caption={
              tasks.length === 0
                ? "Nothing set"
                : doneTasks.length === 0
                  ? `${openTasks.length} open`
                  : `${openTasks.length} open · ${doneTasks.length} done`
            }
          />
          {tasks.length === 0 ? (
            <p className="px-4 pb-2 text-sm text-muted-fg sm:px-5">
              No tasks set — a mentor gives the student work to do between
              meetings.
            </p>
          ) : (
            // The one pane with a gutter at the end of it: when this column is
            // the taller of the two, the "+" sits over the bottom of this list,
            // and a row has to be able to scroll clear of it.
            <div className={`${PANE} pb-14`}>
              <GroupRule label="To do" count={openTasks.length} />
              <ul className="divide-y divide-line/50">
                {openTasks.map((t, i) => (
                  <StudentTaskRow
                    key={t.id}
                    task={t}
                    viewer={viewer}
                    index={i}
                    trailing={renderTaskActions?.(t)}
                  />
                ))}
              </ul>
              <GroupRule label="Finished" count={doneTasks.length} />
              <ul className="divide-y divide-line/50">
                {doneTasks.map((t) => (
                  <StudentTaskRow
                    key={t.id}
                    task={t}
                    viewer={viewer}
                    trailing={renderTaskActions?.(t)}
                  />
                ))}
              </ul>
            </div>
          )}
          {/* Owns its own chrome: a "+" in the corner when closed, a banded
              form at the foot of the column when open. */}
          {taskForm}
        </div>
      </div>

      {/* BELOW, FULL WIDTH — what the hours were bought for */}
      <div className="min-w-0 border-t border-line">
        <ColumnHead
          eyebrow="Planned by an admin"
          title="Agenda"
          caption={
            assignments.length === 0
              ? "Nothing planned"
              : `${formatDuration(assignments.reduce((sum, a) => sum + (a.minuteLimit ?? 0), 0))} budgeted`
          }
        />
        {assignments.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-muted-fg sm:px-5">
            No agenda yet — it arrives with the time an admin allocates.
          </p>
        ) : (
          <div className={PANE}>
            <GroupRule label="In flight" count={planned.length} />
            <ul className="divide-y divide-line/50">
              {toTaskEntries(planned, { mentorBase }).map((t, i) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  viewer={viewer}
                  variant="list"
                  index={i}
                  actions={renderAgendaActions?.(planned[i])}
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
                  actions={renderAgendaActions?.(finished[i])}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}
