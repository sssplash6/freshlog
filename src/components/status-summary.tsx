import { StatusRow } from "@/components/attention-list";
import { Section } from "@/components/ui/section";
import type { Status } from "@/lib/status";

/**
 * What is true of the reader's own account, said on their home page.
 *
 * Not `AttentionList`. That is the bell's inbox — grouped, counted, captioned
 * with whose row it is, dismissible — and a student's home carrying a second
 * copy of it is the "three inboxes" the bell replaced. The rows are the same
 * `StatusRow`, so a state looks the same here as behind the bell.
 *
 * Always titled and counted, one row or ten. Nothing true renders nothing: the ring beside the h1
 * already says the account is fine, and a tick under it would be a second
 * statement of the same news.
 */
export function StatusSummary({
  statuses,
  title = "Needs you",
  className,
}: {
  /** Already sorted — `attentionList` puts the most urgent first. */
  statuses: Status[];
  title?: string;
  className?: string;
}) {
  if (statuses.length === 0) return null;

  // What to do first, then what is merely so. Sorted already within each
  // kind; this only keeps a "to do" from sitting under a piece of news.
  const ordered = [
    ...statuses.filter((s) => s.kind === "actionable"),
    ...statuses.filter((s) => s.kind !== "actionable"),
  ];

  // Always named, and the count is the rows you can see (October 2026).
  //
  // It counted only the actionable rows, so "Things to check 3" sat over five
  // — which a reader takes for a bug, not a policy — and a single row had no
  // heading at all, so the same card was titled on one student's home and
  // anonymous on the next.
  return (
    <Section title={title} count={ordered.length} className={className}>
      <ul className="divide-y divide-line">
        {ordered.map((s, i) => (
          <StatusRow
            key={`${s.type}-${s.subject?.id ?? ""}-${i}`}
            // Amber only where the reader has something to do. Five amber "!"
            // chips on one screen — two of them a mentor's missing calendar,
            // which the student cannot fix — meant none of them stood out; a
            // row that is only news wears the neutral chip.
            status={{
              ...s,
              severity:
                s.kind === "actionable" || s.severity === "problem" ? s.severity : "neutral",
            }}
          />
        ))}
      </ul>
    </Section>
  );
}
