import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { daysAway } from "@/lib/when";

/**
 * A mentor task's deadline, warned the way a mentor plans: a week out.
 *
 * Not `DeadlineText`, which says "expired" — the word for hours that are gone.
 * A late task is still there to be done, so it says "overdue", and a finished
 * one says nothing about lateness at all.
 */
export function MentorTaskDue({
  dueOn,
  now,
  done,
  className,
}: {
  dueOn: Date;
  now: Date;
  done: boolean;
  className?: string;
}) {
  const days = daysAway(dueOn, now);
  const late = !done && days < 0;
  const soon = !done && !late && days <= 7;
  return (
    <span
      className={cn(
        "whitespace-nowrap",
        late ? "font-semibold text-danger-ink" : soon ? "font-semibold text-warn-ink" : "text-ink",
        className
      )}
    >
      {formatDate(dueOn)}
      {late
        ? " · overdue"
        : soon
          ? ` · ${days === 0 ? "today" : days === 1 ? "tomorrow" : `${days} days`}`
          : ""}
    </span>
  );
}
