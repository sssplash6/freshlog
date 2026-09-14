import { ExpandableText } from "@/components/expandable-text";
import { PersonChip } from "@/components/person-chip";
import { Meter } from "@/components/ui/meter";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/cn";
import {
  ASSIGNMENT_PROGRESS_GLYPH,
  ASSIGNMENT_PROGRESS_STATUS,
} from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { studentTaskStatuses, taskProgress } from "@/lib/student-tasks";
import type { Status, ViewerContext } from "@/lib/status";

/** The three progress states, read off the one map rather than a second copy. */
const PROGRESS_TYPES = new Set(Object.values(ASSIGNMENT_PROGRESS_STATUS));

/**
 * One task a mentor set, wherever it appears — the board's right-hand column and
 * the student's own home.
 *
 * ONE row for both readers, on purpose, and it is the lesson `task-row.tsx`
 * records at the top of its own file: the agenda was drawn by four components
 * that disagreed about what colour "over budget" was. What differs between a
 * mentor reading this and the student reading it is not the row — it is what
 * hangs off the end of it, which arrives as `trailing` (the ⋮ menu for the
 * person who set it, the percentage control for the person doing it).
 *
 * The percentage is the one thing here the mentor did not write, so it is drawn
 * as the student's own voice: a bar and a figure, orange like every other
 * measure of progress in the app, and never a colour that says a number is
 * wrong. A task 25% done two days before it is due is not a problem — the
 * deadline passing is, and `TASK_OVERDUE` says so in words.
 */

export type StudentTaskEntry = {
  id: string;
  /** Whose work this is. Carried on every row so a caller deciding whether a
   *  reader may correct it never has to go back to the query for it. */
  programId: string;
  title: string;
  note: string | null;
  dueOn: Date;
  percent: number;
  completedAt: Date | null;
  mentor: {
    id: string;
    name: string | null;
    email: string;
    avatarUpdatedAt?: Date | null;
    /** Their page, when this reader may open it. */
    href?: string;
  };
  /** Named only where a reader holds several — a student in two programs. */
  program?: { id: string; name: string } | null;
};

/** Rows, with the links this reader is entitled to. */
export function toStudentTaskEntries(
  tasks: readonly {
    id: string;
    programId: string;
    title: string;
    note: string | null;
    dueOn: Date;
    percent: number;
    completedAt: Date | null;
    mentor: {
      id: string;
      name: string | null;
      email: string;
      avatarUpdatedAt?: Date | null;
    };
    program?: { id: string; name: string } | null;
  }[],
  { mentorBase, showProgram = false }: { mentorBase?: string; showProgram?: boolean } = {}
): StudentTaskEntry[] {
  return tasks.map((t) => ({
    id: t.id,
    programId: t.programId,
    title: t.title,
    note: t.note,
    dueOn: t.dueOn,
    percent: t.percent,
    completedAt: t.completedAt,
    mentor: {
      ...t.mentor,
      href: mentorBase ? `${mentorBase}/${t.mentor.id}` : undefined,
    },
    program: showProgram ? (t.program ?? null) : null,
  }));
}

export function StudentTaskRow({
  task,
  viewer,
  trailing,
  footer,
  index,
}: {
  task: StudentTaskEntry;
  /** Whose words the chips are in — `lib/status.ts` writes every one of them. */
  viewer: ViewerContext;
  /** The ⋮ menu, for the reader who may correct this row. */
  trailing?: React.ReactNode;
  /** The percentage control, for the one reader who may move it. */
  footer?: React.ReactNode;
  /** Position in the list, for the entrance stagger and nothing else. */
  index?: number;
}) {
  const statuses = studentTaskStatuses(
    {
      id: task.id,
      title: task.title,
      percent: task.percent,
      completedAt: task.completedAt,
      dueOn: task.dueOn,
      mentorId: task.mentor.id,
    },
    viewer
  );
  const of = (type: Status["type"]) => statuses.find((s) => s.type === type);
  const overdue = of("TASK_OVERDUE");
  const progress = taskProgress(task);
  const progressStatus = statuses.find((s) => PROGRESS_TYPES.has(s.type));
  const done = task.completedAt != null;

  return (
    <li
      id={`student-task-${task.id}`}
      className={cn("px-4 py-2 sm:px-5", index != null && "deal-in")}
      style={
        index == null
          ? undefined
          : { animationDelay: `${Math.min(index, 14) * 24}ms` }
      }
    >
      <div className="flex items-start gap-x-3">
        <div className="min-w-0 flex-1">
          <div className="text-[0.9375rem] leading-snug">
            <ExpandableText text={task.title} lines={2} className="font-medium text-ink" />
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* Overdue replaces the plain date rather than sitting beside a
                second copy of it — its own label already carries the day. */}
            {overdue ? (
              <StatusChip status={overdue} />
            ) : (
              <span className="text-xs text-muted-fg">
                {done ? "Was due " : "Due "}
                <span className="font-medium text-ink">{formatDate(task.dueOn)}</span>
              </span>
            )}
            {progressStatus && (
              <StatusChip
                status={progressStatus}
                glyph={ASSIGNMENT_PROGRESS_GLYPH[progress]}
              />
            )}
            <PersonChip person={task.mentor} size="sm" href={task.mentor.href} />
            {task.program && (
              <span className="text-xs text-muted-fg">{task.program.name}</span>
            )}
          </div>

          {task.note && (
            <div className="mt-1.5">
              <ExpandableText
                text={task.note}
                lines={2}
                className="text-xs text-muted-fg"
              />
            </div>
          )}

          {/* The bar carries the figure, so the two can never disagree. Hidden
              at 0% and after it is done: an empty bar says "nothing yet" less
              clearly than the "Not started" chip above it already does, and a
              full one under a ✓ is the same fact twice. */}
          {!done && task.percent > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <Meter
                className="max-w-40"
                size="sm"
                pct={task.percent}
                ariaValueNow={task.percent}
                ariaValueMax={100}
                ariaLabel={`How far along ${task.title} is`}
              />
              <span className="text-xs font-semibold tabular-nums text-ink">
                {task.percent}%
              </span>
            </div>
          )}

          {footer && <div className="mt-2">{footer}</div>}
        </div>

        {trailing && <span className="shrink-0">{trailing}</span>}
      </div>
    </li>
  );
}
