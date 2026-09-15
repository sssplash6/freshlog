import { ExpandableNote } from "@/components/expandable-note";
import { PersonChip } from "@/components/person-chip";
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
      {/* Deadline · Mentor · Title · Progress, in that order and on one line.
          TWO groups, not one wrapping row: the four values used to share a
          single `flex-wrap`, so a long date beside a long name pushed "0% ⋮"
          onto a line of its own — and the note underneath then read as
          belonging to nothing, half a row below the title it is about.
          Progress and the menu sit outside the wrap now, always at the right
          of the first line, and only the three values on the left rewrap.
          Wrapping rather than truncating: a title is a sentence somebody
          wrote, and a row that cuts it off on a phone is a row a phone reader
          cannot act on. */}
      <div className="flex items-start gap-x-2">
        {/* NO WRAPPING, for the reason the meeting row's line carries: with
            `flex-wrap` the title dropped to a line of its own or did not,
            depending on how long that row's mentor happened to be called. The
            title is `flex-1` on a zero basis, so the leftover width is its and
            the MENTOR is what gives way — a long name truncates inside its own
            chip rather than pushing the work this row is about onto a line of
            its own. */}
        <div className="flex min-w-0 flex-1 items-start gap-x-2">
          {/* WHEN. First, because a to-do list is read by what is next, and
              the overdue chip replaces the plain date rather than sitting
              beside a second copy of it — its own label already carries the
              day. */}
          {overdue ? (
            <span className="shrink-0 py-0.5">
              <StatusChip status={overdue} />
            </span>
          ) : (
            // Its own width — see the meeting row. A column wide enough for
            // "September 26" left "October 4" trailing 40px of nothing.
            <span className="shrink-0 whitespace-nowrap py-0.5 text-xs font-medium tabular-nums text-ink">
              {formatDate(task.dueOn)}
            </span>
          )}

          {/* WHO set it. */}
          <span className="flex min-w-0 max-w-44">
            <PersonChip person={task.mentor} size="sm" href={task.mentor.href} />
          </span>
          {task.program && (
            <span className="shrink-0 py-0.5 text-xs text-muted-fg">
              {task.program.name}
            </span>
          )}

          {/* WHAT. The flexible middle, so progress lands against the right
              edge however short the title is. */}
          <span className="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug text-ink">
            {task.title}
          </span>
        </div>

        {/* HOW FAR. A figure, not a word: "50%" is what the student actually
            said, and the three state words are already implied by it at both
            ends. Done keeps its chip, because finishing is the one state that
            is an act rather than a number.

            No meter on the row. A bar and a number are one fact twice, and in
            a half-width column the 48px it wanted came straight out of the
            title beside it — which is the one thing on the line that cannot
            be read in less space than it takes. */}
        <span className="flex shrink-0 items-start gap-1.5 py-0.5">
          {done ? (
            progressStatus && (
              <StatusChip
                status={progressStatus}
                glyph={ASSIGNMENT_PROGRESS_GLYPH[progress]}
              />
            )
          ) : (
            <span
              className="w-9 text-right text-xs font-semibold tabular-nums text-ink"
              aria-label={`${task.percent}% of the way through`}
            >
              {task.percent}%
            </span>
          )}
          {trailing}
        </span>
      </div>

      {/* The description, directly under the line it belongs to. */}
      {task.note && <ExpandableNote text={task.note} className="mt-1" />}

      {footer && <div className="mt-2">{footer}</div>}
    </li>
  );
}
