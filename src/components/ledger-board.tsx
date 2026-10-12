import {
  AllocationBalance,
  AllocationMeter,
  type AllocationEntry,
} from "@/components/allocation-row";
import { HoursBreakdown } from "@/components/hours-breakdown";
import { CrownIcon } from "@/components/icons";
import { SessionRow } from "@/components/session-row";
import { toSessionEntries } from "@/lib/session-entries";
import {
  StudentTaskRow,
  type StudentTaskEntry,
} from "@/components/student-task-row";
import { TaskRow, toTaskEntries } from "@/components/task-row";
import { ShowMoreList } from "@/components/show-more-list";

/** The most rows of any one list that go into the page; the rest are counted, not sent. */
const ROW_CAP = 60;
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
 *   Sessions   left, top     what mentors logged
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
 * FOUR GROUPS, NOT ONE CARD. This was a single card with the balance across
 * the top, two columns under header bands, a strip of page ground between the
 * week and the term, and a floating "+" pinned to a column's corner. Each list
 * is now its own titled group, per the grouped-list rule in DESIGN.md: the
 * title on the page, the rows in a white card, nothing nested.
 *
 * NO SCROLL PANES. The lists grow at wildly different rates — thirty meetings,
 * six agenda items, a dozen tasks — and each used to get a 40svh viewport of
 * its own so the longest could not push the others off the screen. It worked,
 * at the price of three scrolling regions inside a scrolling page. Each list
 * now shows its first five rows and a "Show all" row (`ShowMoreList`), which
 * bounds the page the same way without trapping a thumb.
 *
 * Read-only apart from the row menus and the one form that adds to it. This is
 * the view you open the page for; the panels below it are the workbench.
 */

export function LedgerBoard({
  sessions,
  tasks,
  assignments,
  totals,
  byProgram = [],
  mentorBase,
  renderSessionActions,
  renderTaskActions,
  renderTaskProgress,
  renderAgendaActions,
  banks = [],
  renderBankActions,
  taskForm,
  viewer,
}: {
  /**
   * The student's hour banks, pinned at the top of the agenda. Not a piece of
   * work but the balance every meeting draws, so it leads the list it funds.
   */
  banks?: AllocationEntry[];
  renderBankActions?: (bank: AllocationEntry) => React.ReactNode;
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
  /**
   * The same figures, one row per program, when `totals` adds up more than one.
   *
   * A program's roster counts only that program's hours, and this page counts
   * every program the reader can see, so a student in two programs read 31h
   * remaining here and 22h on the roster they were opened from, with nothing
   * on either page saying why. Each row here is what that program's roster
   * shows. Left out, or with one entry, nothing is drawn.
   */
  byProgram?: {
    id: string;
    name: string;
    allotted: number;
    completed: number;
    remaining: number;
  }[];
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
  /**
   * The percentage control, under the row rather than in a menu.
   *
   * The student's home has had this since tasks existed; the board it is read
   * FROM did not, so a mentor who finished a meeting knowing the draft was
   * half written had nowhere to say so and the row went on claiming 0%.
   */
  renderTaskProgress?: (task: StudentTaskEntry) => React.ReactNode;
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

  // A mentor reads the record, never what the student said about it: the
  // rating and note are left out HERE, on the server, so they are not in the
  // page's payload either. Hiding them in the row only kept them off the
  // screen — anyone who opened the network tab could still read them.
  const meetingRows = toSessionEntries(logged.slice(0, ROW_CAP), {
    mentorBase,
    feedback: viewer.audience !== "mentor",
  }).map((s, i) => (
    <SessionRow
      key={s.id}
      session={s}
      viewer={viewer}
      variant="timeline"
      index={i}
      actions={renderSessionActions?.(logged[i])}
    />
  ));

  const allTasks = [...openTasks, ...doneTasks];
  const taskRows = allTasks.slice(0, ROW_CAP).map((t, i) => (
    <StudentTaskRow
      key={t.id}
      task={t}
      viewer={viewer}
      index={i < openTasks.length ? i : undefined}
      trailing={renderTaskActions?.(t)}
      footer={renderTaskProgress?.(t)}
    />
  ));

  // A row with no menu still keeps the menu's width, so the budget bars down
  // the list end on one edge. Without it the one row a reader may not touch —
  // another mentor's item — had its bar 28px further right than the rest.
  const agendaActions = (task: LedgerAssignment) =>
    renderAgendaActions
      ? (renderAgendaActions(task) ?? (
          <span aria-hidden className="hidden sm:block sm:w-7" />
        ))
      : undefined;

  // Finished work is one line each: it is here to be counted and to be
  // findable, not to be read again.
  const agendaRows = [
    ...toTaskEntries(planned.slice(0, ROW_CAP), { mentorBase }).map((t, i) => (
      <TaskRow
        key={t.id}
        task={t}
        viewer={viewer}
        variant="list"
        index={i}
        actions={agendaActions(planned[i])}
      />
    )),
    ...toTaskEntries(finished.slice(0, Math.max(ROW_CAP - planned.length, 0)), { mentorBase }).map((t, i) => (
      <TaskRow
        key={t.id}
        task={t}
        viewer={viewer}
        variant="line"
        actions={agendaActions(finished[i])}
      />
    )),
  ];

  return (
    <>
      {/* No eyebrow and no caption: "Progress" is what the reader came to find
          out, and every figure a caption could carry is in the key under the
          bar. */}
      <Section title="Progress">
        <div className="px-4 py-3 sm:px-5">
          <HoursBreakdown
            allotted={totals.allotted}
            completed={totals.completed}
            missed={totals.missed}
            remaining={totals.remaining}
            expired={totals.forfeited}
          />
          {byProgram.length > 1 && (
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {byProgram.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-sm"
                >
                  <span className="min-w-0 font-medium text-ink">{p.name}</span>
                  <span className="tabular-nums text-muted-fg">
                    {formatDuration(p.completed)} completed ·{" "}
                    {p.remaining < 0
                      ? `${formatDuration(-p.remaining)} over`
                      : `${formatDuration(p.remaining)} remaining`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      {/* The week: the meeting that happened and the work it sent the student
          away with, side by side from lg. Two groups, each its own card — they
          used to be two columns of ONE card under internal header bands, which
          is a card wearing lids. `items-start` so a short list is not
          stretched to the height of a long one. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* "Sessions": DESIGN.md's vocabulary keeps "meeting" for what is
            booked and "session" for what was logged, and this list is only
            the logged. */}
        <Section title="Sessions" count={logged.length}>
          {logged.length === 0 ? (
            <p className="px-4 py-3 text-body text-muted-fg sm:px-5">
              No sessions logged yet.
            </p>
          ) : (
            // The inset goes on the ROWS, not on this list: `divide-y` draws
            // its hairline on the child's border box, so padding the list
            // would pull every rule short of the card's edges. `SessionRow`'s
            // timeline shape carries no horizontal padding of its own.
            <ShowMoreList
              rows={meetingRows}
              total={logged.length}
              noun="sessions"
              className="[&>li]:px-4 sm:[&>li]:px-5"
            />
          )}
        </Section>

        <Section
          title="Tasks"
          count={tasks.length}
          // The whole log's shape, not just what is left: a mentor opening
          // somebody they have not seen in a month wants to know what was
          // finished as much as what is outstanding.
          // Only once something is done: "1 open" beside a count of 1 said
          // the same number twice.
          caption={
            doneTasks.length === 0
              ? undefined
              : `${openTasks.length} open · ${doneTasks.length} done`
          }
        >
          {tasks.length === 0 ? (
            <p className="px-4 py-3 text-body text-muted-fg sm:px-5">
              No tasks set yet.
            </p>
          ) : (
            <ShowMoreList rows={taskRows} total={allTasks.length} noun="tasks" />
          )}
          {/* The last row of the group, iOS's "Add…" row: closed it is one
              brand line, open it is the form in the same place. */}
          {taskForm}
        </Section>
      </div>

      {/* The term: what the hours were bought for. It moves at the pace of a
          grant rather than of a Tuesday, so it sits under the week at full
          width, where its budget bars have room. The caption is the budget,
          and says so: a bare "6h" at the end of a heading read as anything —
          time used, time left, time owed. */}
      <Section
        title="Agenda"
        count={assignments.length}
        caption={
          assignments.length === 0
            ? undefined
            : `${formatDuration(
                assignments.reduce((sum, a) => sum + (a.minuteLimit ?? 0), 0)
              )} planned`
        }
      >
        {banks.length > 0 && (
          <ul className="divide-y divide-line border-y border-line">
            {banks.map((bank) => (
              <li key={bank.program.id} className="px-4 py-2.5 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
                    <CrownIcon className="h-4 w-4 shrink-0 text-accent-ink" />
                    Hour bank
                    {banks.length > 1 && (
                      <span className="font-normal text-muted-fg">
                        · {bank.program.name}
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <AllocationBalance entry={bank} />
                    {renderBankActions?.(bank)}
                  </div>
                </div>
                <AllocationMeter
                  entry={bank}
                  viewer={viewer}
                  label={`Hour bank, ${bank.program.name}`}
                  className="mt-2"
                />
              </li>
            ))}
          </ul>
        )}
        {assignments.length === 0 ? (
          banks.length === 0 && (
            <p className="px-4 py-3 text-body text-muted-fg sm:px-5">
              No agenda planned yet.
            </p>
          )
        ) : (
          <ShowMoreList rows={agendaRows} total={planned.length + finished.length} noun="agenda items" />
        )}
      </Section>
    </>
  );
}
