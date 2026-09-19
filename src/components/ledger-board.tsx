import { HoursBreakdown } from "@/components/hours-breakdown";
import { SessionRow } from "@/components/session-row";
import { toSessionEntries } from "@/lib/session-entries";
import {
  StudentTaskRow,
  type StudentTaskEntry,
} from "@/components/student-task-row";
import { TaskRow, toTaskEntries } from "@/components/task-row";
import { Section } from "@/components/ui/section";
import { ASSIGNMENT_PROGRESS } from "@/lib/constants";
import { formatDuration } from "@/lib/format";
import type { LedgerAssignment, LedgerSession } from "@/lib/queries";
import { taskIsOpen } from "@/lib/student-tasks";
import type { ViewerContext } from "@/lib/status";

/**
 * How far this student has got — the tracking spreadsheet's whole tab on one
 * screen, in the shape the week actually has: what happened, what the student
 * is doing about it, and what the hours were budgeted for.
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
 * 40svh, not `vh`: mobile browsers shrink the visible viewport when the URL bar
 * is showing, and `vh` panes are what leave a phone reader scrolling a pane
 * inside a page that is also scrolling. It was 60, which on a laptop is most of
 * the screen — and since the two top columns stretch to each other, a student
 * with thirty meetings and one task got a 540px pane beside 60px of content and
 * a card nothing else on the page could be read next to. Four or five rows is
 * what a pane is FOR; the rest is what the scrollbar is for.
 *
 * Read-only apart from the row menus and the one form that adds to it. This is
 * the view you open the page for; the panels below it are the workbench.
 */

/**
 * One pane's scrolling body. A column heading and the form under it stay put;
 * only the rows move, or a reader scrolling a long log loses the heading that
 * says which log it is.
 *
 * No `overscroll-contain`, deliberately. Containing the scroll traps the reader:
 * a wheel or a thumb that reaches the end of a pane stops dead, and the page
 * behind it does not move until they find somewhere else to put the cursor.
 * Chaining to the page is what every scrollable region on the web does, so it is
 * what a hand already expects — and this pane is a viewport onto a list, not a
 * modal that has to hold the reader inside it.
 */
const PANE = "max-h-[40svh] overflow-y-auto";

/**
 * A column heading inside the board — smaller than a panel's, same grammar.
 *
 * No eyebrow. "Logged by mentors", "Set by a mentor" and "Planned by an admin"
 * named WHO WRITES each list, which is a fact about permissions rather than
 * about the work — and the ⋮ menu on a row is already there or not there
 * depending on the answer. Three of them down one card also meant the eye met
 * a line of small caps before every heading it actually wanted.
 */
function ColumnHead({
  title,
  caption,
  count,
}: {
  title: string;
  caption?: string;
  count?: number;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-line px-4 pb-2.5 pt-4 sm:px-5">
      <div className="flex items-baseline gap-1.5">
        <h3 className="text-[0.9375rem] font-bold tracking-tight text-ink">{title}</h3>
        {count != null && (
          <span className="text-xs font-semibold tabular-nums text-muted-fg">{count}</span>
        )}
      </div>
      {/* Optional: a column whose figures are all stated elsewhere in the card
          gets a heading and nothing else, rather than a number invented to
          fill the right-hand side of the line. */}
      {caption && (
        <span className="text-xs tabular-nums text-muted-fg">{caption}</span>
      )}
    </div>
  );
}

export function LedgerBoard({
  sessions,
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
  const logged = sessions;

  const openTasks = tasks.filter(taskIsOpen);
  const doneTasks = tasks.filter((t) => !taskIsOpen(t));

  const planned = assignments.filter(
    (a) => a.progress !== ASSIGNMENT_PROGRESS.DONE,
  );
  const finished = assignments.filter(
    (a) => a.progress === ASSIGNMENT_PROGRESS.DONE,
  );

  return (
    // No eyebrow. "At a glance" described the card's SHAPE rather than its
    // subject, which is the one thing a heading may not spend itself on — and
    // this is the first card on the page, so there is nothing above it for an
    // eyebrow to distinguish it from. "Progress" is what the reader came to
    // find out; the three column heads below say which three lists answer it.
    // No caption. Every figure it carried is counted again a few pixels
    // below it, on the group rule of the very list it was counting.
    <Section title="Progress">
      {/* The sheet's right-hand totals, given the width they deserve. */}
      <div className="border-b border-line px-4 py-2 sm:px-5">
        <HoursBreakdown
          allotted={totals.allotted}
          completed={totals.completed}
          missed={totals.missed}
          remaining={totals.remaining}
        />
      </div>

      <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-line">
        {/* LEFT — what happened, and what is about to */}
        <div className="min-w-0 border-b border-line lg:border-b-0">
          {/* No figure at all. "14h 22m completed" was the breakdown's own
              headline restated twelve pixels below it, in grey instead of the
              colour the bar uses for it, so the card looked like it held two
              sums. And a count of logged meetings is already in the card's
              caption above and on the group rule below. */}
          <ColumnHead title="Meetings" count={logged.length} />
          {logged.length === 0 ? (
            <p className="px-4 pb-5 text-sm text-muted-fg sm:px-5">
              No meetings logged yet.
            </p>
          ) : (
            <div className={PANE}>
              {/* The inset goes on the ROWS, not on this list: `divide-y` draws
                  its hairline on the child's border box, so padding the list
                  would pull every rule 20px short of the edges while the
                  Tasks column's run full width.

                  It has to be here at all because `SessionRow`'s timeline
                  shape carries no horizontal padding of its own — it is
                  normally dropped inside something that already has some, as
                  it is on the student's home. In this pane there is nothing
                  between it and the edge, so a hovered row's pencil widened
                  into the column divider and every other row in the card
                  started 20px further in than these did. */}
              <ul className="divide-y divide-line [&>li]:px-4 sm:[&>li]:px-5">
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
            `relative` so the "+" can pin itself to this column's own corner,
            and `min-h-40` so the corner is never IN the heading: with no tasks
            set and a short meetings list beside it, the column was about a
            hundred pixels tall and a 44px button pinned twelve from its bottom
            landed on top of the caption. */}
        <div className="relative min-h-40 min-w-0">
          <ColumnHead
            title="Tasks"
            count={tasks.length}
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
              No tasks set.
            </p>
          ) : (
            // The one pane with a gutter at the end of it: when this column is
            // the taller of the two, the "+" sits over the bottom of this list,
            // and a row has to be able to scroll clear of it.
            <div className={`${PANE} pb-14`}>
              <ul className="divide-y divide-line">
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
              <ul className="divide-y divide-line">
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

      {/* The break between the week and the term. A hairline is what divides
          the two columns FROM EACH OTHER, and the same hairline underneath
          them said the agenda was a third column that happened to be wider.
          A band of the page's own ground, hairlined top and bottom, says what
          is true instead: two panels, not one card with a line across it. */}
      <div className="h-2 border-y border-line bg-canvas" aria-hidden="true" />

      {/* BELOW, FULL WIDTH — what the hours were bought for */}
      <div className="min-w-0">
        {/* The figure, and no word after it. "16h 30m budgeted" was the only
            total in the card wearing a label, and the card is a column of
            durations — a number in this position is the hours, which is the
            one thing every other figure here is too. */}
        <ColumnHead
          title="Agenda"
          count={assignments.length}
          caption={
            assignments.length === 0
              ? undefined
              : formatDuration(
                  assignments.reduce((sum, a) => sum + (a.minuteLimit ?? 0), 0)
                )
          }
        />
        {assignments.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-muted-fg sm:px-5">
            No agenda yet.
          </p>
        ) : (
          <div className={PANE}>
            <ul className="divide-y divide-line">
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
            {/* Finished work is one line each: it is here to be counted and
                to be findable, not to be read again. */}
            <ul className="divide-y divide-line">
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
