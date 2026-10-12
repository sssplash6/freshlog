import { ExpandableText } from "@/components/expandable-text";
import { PersonChip } from "@/components/person-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, Td, Tr, type Column } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { Section } from "@/components/ui/section";
import {
  ASSIGNMENT_PROGRESS,
  ASSIGNMENT_PROGRESS_GLYPH,
  ASSIGNMENT_PROGRESS_STATUS,
} from "@/lib/constants";
import { formatDate, formatDuration, formatMinutes } from "@/lib/format";
import { taskStatuses, type Status, type ViewerContext } from "@/lib/status";

/**
 * One line of the AGENDA — a piece of work an admin budgeted hours for —
 * wherever it appears. Not a `StudentTask`, which is what a mentor sets a
 * student to go away and do and which `student-task-row.tsx` draws; see
 * `lib/student-tasks.ts` for the split.
 *
 * Four renderers drew this row, and the two on the student's own page drew it
 * twice on one screen: `AssignmentsPanel`'s seven-column table and
 * `LedgerBoard.TaskRow` rendered the same task at the same time, and disagreed
 * about it — over budget was amber in the table and red in the board, "Done"
 * was a green wash in one and a grey wash in the other. `StudentGoals` drew a
 * third version as a card, and the program page a fourth as a table missing the
 * budget bar. Three of the four kept their own progress-to-colour map.
 *
 * Two rules settle all of that, and neither is this file's to choose:
 *
 * OVER BUDGET IS DANGER, EVERYWHERE. Overspend on a task is a problem with the
 * plan, not a nudge, and `TASK_OVER_BUDGET` is `severity: "problem"` — so the
 * number, the chip and the meter all take red, on every page. The row asks
 * `taskStatuses` whether it is over rather than comparing the two numbers
 * itself, which is also why a student — who is never told about a budget — sees
 * no red they cannot read an explanation for.
 *
 * DONE IS A ✓ CHIP WITH NO WASH. A tinted row is a colour with no words, it
 * fought the row's own status chip, and it spent a background on the one state
 * nobody needs to find. Progress stays a shape — ○ ◐ ✓ from
 * `ASSIGNMENT_PROGRESS_GLYPH` — on a neutral chip.
 *
 *   table  the plan as a ledger — a student's page, a program's page
 *   list   the plan read forward: purpose, whose it is, a budget meter
 *   line   the settled subset, one line each, behind a "Finished · 6 ▸" fold
 */

type RowPerson = {
  id: string;
  name: string | null;
  email: string;
  avatarUpdatedAt?: Date | null;
  /** Their page, when this reader may open it. */
  href?: string;
};

/**
 * Structural, not Prisma-derived: a student's tasks and a program's tasks are
 * two queries, and the program's carries a student the student's does not.
 */
export type TaskEntry = {
  id: string;
  /** Often written as a sentence, so it is clamped like any other free text. */
  purpose: string;
  /** `ASSIGNMENT_PROGRESS`. */
  progress: string;
  minuteLimit: number | null;
  loggedMinutes: number;
  /**
   * The deadline as somebody typed it — "March–May", "before the deadline".
   * Kept beside `dueOn` because the column is still free text: until it splits,
   * this is the only due most tasks have, and it cannot be compared to a clock.
   */
  due?: string | null;
  /** A real date, once there is one. The only thing that decides overdue. */
  dueOn?: Date | null;
  note: string | null;
  /** Null is a state, not missing data: budgeted work on nobody's list yet. */
  mentor?: RowPerson | null;
  /**
   * Present only on a list that spans students. `id` is the USER's, like every
   * face in the app; `profileId` is what their page and their statuses key on.
   */
  student?: (RowPerson & { profileId: string }) | null;
};

export type TaskColumn =
  | "task"
  | "student"
  | "mentor"
  | "hours"
  | "due"
  | "progress"
  /** The ⋮ menu. `TaskTable` adds it when any row has one. */
  | "actions";

const DEFAULT_COLUMNS: TaskColumn[] = [
  "task",
  "student",
  "mentor",
  "hours",
  "due",
  "progress",
];

/**
 * The rendered slots, in the one order every task table uses.
 *
 * Six, because six is the cap a phone can stack. Two merges get it there and
 * both remove a real redundancy rather than hiding a fact: `student` and
 * `mentor` share the `people` slot, and logged-vs-budget share `hours` — they
 * were two right-aligned columns the reader had to subtract in their head,
 * which is exactly what the meter beneath them is for.
 */
const SLOTS = ["task", "people", "hours", "due", "progress", "actions"] as const;
type Slot = (typeof SLOTS)[number];

function slotsFor(columns: TaskColumn[]): Slot[] {
  return SLOTS.filter((slot) =>
    slot === "people"
      ? columns.includes("student") || columns.includes("mentor")
      : columns.includes(slot),
  );
}

/** The people slot's heading, reused as the stacked row's label on a phone. */
function peopleLabel(columns: TaskColumn[]): string {
  const student = columns.includes("student");
  const mentor = columns.includes("mentor");
  return student && mentor ? "Student · Mentor" : student ? "Student" : "Mentor";
}

const SLOT_LABEL: Record<Exclude<Slot, "people" | "actions">, string> = {
  task: "Agenda item",
  hours: "Logged · Budget",
  due: "Due",
  progress: "Progress",
};

/** The header, from the same function the cells use, so the two cannot drift. */
function headerFor(columns: TaskColumn[]): Column[] {
  return slotsFor(columns).map((slot) => {
    if (slot === "people") return { label: peopleLabel(columns) };
    if (slot === "actions") return { label: "", align: "right" as const };
    return { label: SLOT_LABEL[slot] };
  });
}

/** The three progress states, read off the one map rather than a fourth copy. */
const PROGRESS_TYPES = new Set(Object.values(ASSIGNMENT_PROGRESS_STATUS));

const nameOf = (person: RowPerson) => person.name ?? person.email;

/** A value the row does not have. Never a blank cell — a blank reads as a bug. */
function Dash() {
  return <span className="text-muted-fg">—</span>;
}

export function TaskRow({
  task,
  viewer,
  variant = "table",
  columns = DEFAULT_COLUMNS,
  actions,
  index,
}: {
  task: TaskEntry;
  /** Whose words the chips are in — a student reads "Mentor to be confirmed". */
  viewer: ViewerContext;
  variant?: "table" | "list" | "line";
  /** `table` only. Ignored by the two list shapes, which show every fact. */
  columns?: TaskColumn[];
  /** Edit · Remove · a progress control — already resolved for this reader. */
  actions?: React.ReactNode;
  /** Position in the list, for the entrance stagger and nothing else. */
  index?: number;
}) {
  const {
    id,
    purpose,
    progress,
    minuteLimit,
    loggedMinutes,
    due,
    dueOn,
    note,
    mentor,
    student,
  } = task;

  const statuses = taskStatuses(
    {
      id,
      purpose,
      progress,
      mentorId: mentor?.id ?? null,
      minuteLimit,
      loggedMinutes,
      dueOn: dueOn ?? null,
      ...(student ? { student: { id: student.profileId, name: nameOf(student) } } : {}),
    },
    viewer,
  );

  // Each state renders beside the thing it is about, rather than all of them
  // in one pile at the end of the row: "Needs a mentor" where the mentor would
  // be, "over budget" against the hours it overspent, overdue in the due
  // column. That is the difference between a row that reads and a row with a
  // chip drawer bolted on.
  const of = (type: Status["type"]) => statuses.find((s) => s.type === type);
  const progressStatus = statuses.find((s) => PROGRESS_TYPES.has(s.type));
  const needsMentor = of("TASK_NEEDS_MENTOR");
  const overdue = of("TASK_OVERDUE");
  const overBudget = of("TASK_OVER_BUDGET");

  const anchor = `task-${id}`;
  const stagger =
    index == null ? undefined : { animationDelay: `${Math.min(index, 14) * 24}ms` };

  // No "pinned" marker. Whether the state was typed by a person or derived
  // from the hours is bookkeeping about HOW the row got its word, not a fact
  // about the work — and it rode beside every finished row, where it is never
  // the answer to anything. The ⋮ menu still says it, next to the control that
  // sets it, which is where somebody asking the question already is.
  const progressChip = progressStatus && (
    <StatusChip status={progressStatus} glyph={ASSIGNMENT_PROGRESS_GLYPH[progress]} />
  );

  // Always clamped, and deliberately not a link: a task has no page of its own,
  // and an anchor wrapping an ExpandableText would put its "Show more" button
  // inside a link. The row's destinations are its people.
  const title = (
    <ExpandableText text={purpose} lines={2} className="font-semibold text-ink" />
  );

  const people = (
    <>
      {/* Same shape as the mentor below: both are "who this task involves",
          and a bare name on top of a pill read as two kinds of value. */}
      {student && columns.includes("student") && (
        <span className="block min-w-0">
          <PersonChip person={student} size="sm" href={student.href} />
        </span>
      )}
      {mentor ? (
        <PersonChip
          person={mentor}
          size="sm"
          href={mentor.href}
          className={student && columns.includes("student") ? "mt-1" : undefined}
        />
      ) : (
        needsMentor && <StatusChip status={needsMentor} />
      )}
    </>
  );

  // "45 min / 2h", one value instead of two columns and a subtraction. A row
  // with no ceiling is just the logged figure: no slash means nothing caps it,
  // which says it without spending a word on saying it.
  const hours = (
    <span className="tabular-nums">
      <span
        className={cn(
          "font-semibold",
          overBudget ? "text-danger-ink" : loggedMinutes > 0 ? "text-ink" : "text-muted-fg",
        )}
      >
        {formatMinutes(loggedMinutes)}
      </span>
      <span className="text-muted-fg">
        {minuteLimit == null ? "" : ` / ${formatMinutes(minuteLimit)}`}
      </span>
    </span>
  );

  const meter =
    minuteLimit != null && minuteLimit > 0 ? (
      <Meter
        pct={(loggedMinutes / minuteLimit) * 100}
        tone={overBudget ? "danger" : "accent"}
        size="sm"
        ariaLabel={`${formatMinutes(loggedMinutes)} of ${formatMinutes(minuteLimit)} logged`}
        ariaValueNow={loggedMinutes}
        ariaValueMax={minuteLimit}
      />
    ) : null;

  // An overdue task's own label already carries the date ("Due Aug 10, not
  // done"), so the chip replaces the date rather than sitting beside a second
  // copy of it. Otherwise the due is plain text: a chip among dates reads as a
  // different kind of value.
  const dueText = due?.trim() ? due : dueOn ? formatDate(dueOn) : null;
  const dueCell = overdue ? (
    <StatusChip status={overdue} />
  ) : dueText ? (
    <span className="text-ink">{dueText}</span>
  ) : (
    <Dash />
  );

  if (variant === "line") {
    return (
      <li
        id={anchor}
        className={cn(
          "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5",
          index != null && "deal-in",
        )}
        style={stagger}
      >
        {progressChip}
        <span className="min-w-0 flex-1 truncate text-body text-ink">{purpose}</span>
        {mentor && <PersonChip person={mentor} size="sm" href={mentor.href} />}
        <span className="text-xs tabular-nums text-muted-fg">
          {formatMinutes(loggedMinutes)}
        </span>
        {actions && <span className="shrink-0">{actions}</span>}
      </li>
    );
  }

  if (variant === "list") {
    return (
      <li
        id={anchor}
        className={cn("relative px-4 py-3 sm:px-5", index != null && "deal-in")}
        style={stagger}
      >
        {/* Two columns from sm up, because the one-column version left the
            whole right half of the row empty and stacked the budget, the due
            date and the bar under the title in a narrow ribbon down the left.
            What the work IS goes left; what it COSTS goes right, on the same
            baseline as the title it belongs to. Below sm they stack, which is
            the only shape that fits 390px. */}
        <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
          <div className="min-w-0 flex-1 basis-56 max-sm:pr-10">
            {/* WHEN it is due, beside WHAT it is. The date used to sit in the
                right-hand column under the hours, so a row said what the work
                costs twice over and never once said when it is wanted next to
                the name of it. */}
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="min-w-0 text-body leading-snug">{title}</span>
              {overdue ? (
                <StatusChip status={overdue} />
              ) : (
                dueText && (
                  <span className="shrink-0 text-xs text-muted-fg">Due {dueText}</span>
                )
              )}
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {mentor ? (
                <PersonChip person={mentor} size="sm" href={mentor.href} />
              ) : (
                needsMentor && <StatusChip status={needsMentor} />
              )}
              {progressChip}
            </div>

            {note && (
              <div className="mt-1.5">
                <ExpandableText text={note} lines={2} className="text-xs text-muted-fg" />
              </div>
            )}
          </div>

          <div className="w-full shrink-0 text-xs sm:w-64">
            {/* The overspend BESIDE the figure it is about, and before it:
                the hours then end at the row's right edge on every line, so
                the column of figures stays a column. It was under the hours
                on a line of its own, where it read as a third fact rather
                than as a remark about the second. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap sm:justify-end">
              {overBudget && <StatusChip status={overBudget} />}
              {hours}
            </div>
            {/* The budget as a bar, so a plan running past its hours is visible
                without reading two numbers and subtracting them. */}
            {meter && <div className="mt-1.5">{meter}</div>}
          </div>

          {/* In the corner on a phone, where it was a line of its own under
              the meter: the same corner a table row's menu takes (`Td corner`). */}
          {actions && (
            <span className="shrink-0 max-sm:absolute max-sm:right-2 max-sm:top-1.5">{actions}</span>
          )}
        </div>
      </li>
    );
  }

  // A standalone row may carry a menu without its caller having listed the
  // column; inside a table the column is listed for every row as soon as one
  // row has a menu, so the header can never fall out of step with the cells.
  const slots = slotsFor(
    actions && !columns.includes("actions") ? [...columns, "actions"] : columns,
  );

  return (
    <Tr id={anchor} className={cn(index != null && "deal-in")} style={stagger}>
      {slots.map((slot) => {
        switch (slot) {
          case "task":
            return (
              <Td key={slot} label="Agenda item" className="sm:max-w-xs">
                {title}
                {/* What somebody said about this task that its state cannot
                    carry — a missed week, an open question. Clamped: it was
                    unbounded here, and one paragraph made the row forty lines. */}
                {note && (
                  <div className="mt-0.5">
                    <ExpandableText text={note} lines={2} className="text-xs text-muted-fg" />
                  </div>
                )}
              </Td>
            );
          case "people":
            return (
              <Td key={slot} label={peopleLabel(columns)}>
                {people}
              </Td>
            );
          case "hours":
            return (
              <Td key={slot} label="Logged · Budget" className="sm:w-44">
                {hours}
                {overBudget && (
                  <div className="mt-1">
                    <StatusChip status={overBudget} />
                  </div>
                )}
                {meter && <div className="mt-1.5 max-w-32">{meter}</div>}
              </Td>
            );
          case "due":
            return (
              <Td key={slot} label="Due" className="sm:max-w-40">
                {dueCell}
              </Td>
            );
          case "progress":
            return (
              <Td key={slot} label="Progress">
                {progressChip}
              </Td>
            );
          case "actions":
            return (
              <Td key={slot} align="right" corner className="align-top">
                {actions}
              </Td>
            );
        }
      })}
    </Tr>
  );
}

/**
 * The plan as a table.
 *
 * Like `SessionsTable`, it renders the table and nothing around it.
 * `AssignmentsPanel` owned a `Section`, an "Allocate time" form and a footer
 * sentence adding up three totals it recomputed from the rows it was handed —
 * so a page showing eight of a student's twelve tasks stated a budget that was
 * true of neither. Totals belong to the query that can see all of them, the
 * form belongs to the page, and the fold over finished work belongs to a
 * `Disclosure` around a second table.
 */
export function TaskTable({
  tasks,
  viewer,
  columns = DEFAULT_COLUMNS,
  renderActions,
  framed = true,
  empty,
  className,
}: {
  tasks: TaskEntry[];
  viewer: ViewerContext;
  columns?: TaskColumn[];
  /**
   * A row's own menu. A function because the answer is per row, and returning
   * nothing for every row drops the column instead of leaving an empty one.
   */
  renderActions?: (task: TaskEntry) => React.ReactNode;
  framed?: boolean;
  /** Pass an `EmptyState variant="no-results"` when a filter did the emptying. */
  empty?: React.ReactNode;
  className?: string;
}) {
  if (tasks.length === 0) {
    return (
      empty ?? (
        <EmptyState framed={framed} title="No agenda">
          It arrives with the time an admin allocates for each piece of work.
        </EmptyState>
      )
    );
  }

  const rowActions = tasks.map((t) => renderActions?.(t));
  const withActions = rowActions.some(Boolean);

  // A column earns its place only when the rows differ in it. One mentor's own
  // task list would otherwise repeat their name down the page, and a column of
  // em dashes is a column carrying nothing — which is how a table reaches seven
  // columns while answering six questions.
  const hasStudent = columns.includes("student") && tasks.some((t) => t.student);
  const spansMentors = new Set(tasks.map((t) => t.mentor?.id ?? "")).size > 1;
  const hasDue = tasks.some((t) => t.due?.trim() || t.dueOn);
  const resolved: TaskColumn[] = columns.filter((c) => {
    if (c === "student") return hasStudent;
    // Kept when anyone is missing one, whatever else the rows share: "Needs a
    // mentor" is the actionable state on this table and must not be the thing
    // a tidy-up hides. Never both dropped — a row with no person is unreadable.
    if (c === "mentor") return spansMentors || tasks.some((t) => !t.mentor) || !hasStudent;
    if (c === "due") return hasDue;
    return c !== "actions";
  });
  if (withActions) resolved.push("actions");

  return (
    <Table framed={framed} columns={headerFor(resolved)} className={className}>
      {tasks.map((task, i) => (
        <TaskRow
          key={task.id}
          task={task}
          viewer={viewer}
          variant="table"
          columns={resolved}
          actions={rowActions[i]}
          index={i}
        />
      ))}
    </Table>
  );
}

/**
 * A task as the database hands it over. Separate from `TaskEntry` for the
 * reason the session row's is: this is what a caller HAS, that is what the row
 * NEEDS, and the mapping between them belongs in one place rather than at five
 * call sites.
 */
export type PlannedTask = {
  id: string;
  purpose: string;
  progress: string;
  minuteLimit: number | null;
  loggedMinutes: number;
  dueNote: string | null;
  dueOn: Date | null;
  note: string | null;
  mentor?: {
    id: string;
    name: string | null;
    email: string;
    avatarUpdatedAt?: Date | null;
  } | null;
  student?: {
    id: string;
    user: { id: string; name: string | null; email: string; avatarUpdatedAt?: Date | null };
  } | null;
};

/**
 * Rows, with the links this reader is entitled to. Bases rather than
 * functions: a function cannot cross into a client component — it type-checks,
 * it builds, and it throws at render.
 */
export function toTaskEntries(
  tasks: readonly PlannedTask[],
  links: { mentorBase?: string; studentBase?: string } = {}
): TaskEntry[] {
  return tasks.map((t) => ({
    id: t.id,
    purpose: t.purpose,
    progress: t.progress,
    minuteLimit: t.minuteLimit,
    loggedMinutes: t.loggedMinutes,
    due: t.dueNote,
    dueOn: t.dueOn,
    note: t.note,
    mentor: t.mentor
      ? {
          id: t.mentor.id,
          name: t.mentor.name,
          email: t.mentor.email,
          avatarUpdatedAt: t.mentor.avatarUpdatedAt,
          href: links.mentorBase ? `${links.mentorBase}/${t.mentor.id}` : undefined,
        }
      : null,
    student: t.student
      ? {
          id: t.student.user.id,
          profileId: t.student.id,
          name: t.student.user.name,
          email: t.student.user.email,
          avatarUpdatedAt: t.student.user.avatarUpdatedAt,
          href: links.studentBase
            ? `${links.studentBase}/${t.student.id}`
            : undefined,
        }
      : null,
  }));
}

/**
 * The plan for one student, under a heading: what `AssignmentsPanel` was.
 *
 * The footer is the reason this is a component rather than a bare table. Three
 * figures — logged, budgeted, allotted — only mean something beside each other,
 * and the one comparison that catches a real mistake is the third against the
 * second: a plan that promises more work than the student has paid for. Two of
 * the four surfaces that render tasks were showing the first two and not the
 * third, so the mistake was invisible on both.
 */
export function TasksPanel({
  tasks,
  viewer,
  minutesAllotted,
  columns,
  renderActions,
  empty,
  children,
}: {
  tasks: TaskEntry[];
  viewer: ViewerContext;
  /** What the student actually holds, which the budget is measured against. */
  minutesAllotted: number;
  columns?: TaskColumn[];
  renderActions?: (task: TaskEntry) => React.ReactNode;
  empty?: React.ReactNode;
  /** The add-a-task form, for the readers who may write here. */
  children?: React.ReactNode;
}) {
  const planned = tasks.reduce((sum, t) => sum + (t.minuteLimit ?? 0), 0);
  const logged = tasks.reduce((sum, t) => sum + t.loggedMinutes, 0);
  const done = tasks.filter(
    (t) => t.progress === ASSIGNMENT_PROGRESS.DONE
  ).length;
  const overPlanned = planned > minutesAllotted;

  return (
    <Section
      eyebrow="What the time is for"
      title="Agenda"
      caption={
        tasks.length === 0
          ? "Nothing planned yet"
          : `${done}/${tasks.length} done · ${formatDuration(planned)}`
      }
    >
      {tasks.length === 0 ? (
        (empty ?? (
          <EmptyState framed={false} title="No agenda yet">
            An admin sets out the work planned for this student.
          </EmptyState>
        ))
      ) : (
        <>
          <TaskTable
            tasks={tasks}
            viewer={viewer}
            columns={columns}
            renderActions={renderActions}
            framed={false}
          />

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-xs sm:px-5">
            <span className="text-muted-fg">
              <span className="font-semibold tabular-nums text-ink">
                {formatDuration(logged)}
              </span>{" "}
              logged against{" "}
              <span className="font-semibold tabular-nums text-ink">
                {formatDuration(planned)}
              </span>{" "}
              budgeted, of{" "}
              <span className="font-semibold tabular-nums text-ink">
                {formatDuration(minutesAllotted)}
              </span>{" "}
              allotted
            </span>
            {overPlanned && (
              <span className="font-medium text-warn-ink">
                Budgeted work exceeds the hours this student holds by{" "}
                {formatDuration(planned - minutesAllotted)}.
              </span>
            )}
          </div>
        </>
      )}

      {children && (
        <div className="border-t border-line px-4 py-2 sm:px-5">{children}</div>
      )}
    </Section>
  );
}
