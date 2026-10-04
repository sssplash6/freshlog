import Link from "next/link";

import { ChevronRightIcon } from "@/components/icons";
import { Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/cn";
import { actionableCount, type Status } from "@/lib/status";

/**
 * What is true of the reader's own account, said on their home page.
 *
 * Not `AttentionList`. That is the bell's inbox — grouped, counted, captioned
 * with whose row it is, dismissible — and a student's home carrying a second
 * copy of it is the "three inboxes" the bell replaced. This is quieter: a chip
 * and the sentence that goes with it, the sentence printed rather than hidden
 * in a tooltip, because on a phone there is no hover and "No time yet" alone
 * does not say whether to wait or to ask.
 *
 * One row needs no heading — the row is the heading. Two or more are a list,
 * and a list is named. Nothing true renders nothing: the ring beside the h1
 * already says the account is fine, and a tick under it would be a second
 * statement of the same news.
 */
export function StatusSummary({
  statuses,
  title,
  className,
}: {
  /** Already sorted — `attentionList` puts the most urgent first. */
  statuses: Status[];
  /** Shown only when there is more than one row. */
  title: string;
  className?: string;
}) {
  if (statuses.length === 0) return null;
  const many = statuses.length > 1;

  const rows = (
    <ul className="divide-y divide-line">
      {statuses.map((s, i) => (
        <SummaryRow key={`${s.type}-${s.subject?.id ?? i}`} status={s} />
      ))}
    </ul>
  );

  // A list is named the way every group is: title on the page ground, one
  // white card under it. It drew its own bold header band inside the card,
  // the one lid left on the student home after the rest were taken off.
  if (many) {
    // The same rows appear under this title in the bell's AttentionList,
    // which numbers only the rows that ask something of the reader — an
    // informational row under the same title counted "5" here and "3" there.
    const count = actionableCount(statuses);
    return (
      <Section
        title={title}
        count={count > 0 ? count : undefined}
        className={className}
      >
        {rows}
      </Section>
    );
  }

  return (
    <section
      aria-label={title}
      className={cn("overflow-clip rounded-xl bg-surface shadow-sm", className)}
    >
      {rows}
    </section>
  );
}

function SummaryRow({ status }: { status: Status }) {
  const { explanation, subject, href } = status;
  // flex-1: without it the body is only as wide as its content, so a long
  // mentor name wrapped under the chip on one row and sat beside it on the next.
  const body = (
    <span className="min-w-0 flex-1">
      {/* Chip, then who it is about, on their own lines: side by side they
          wrapped or not depending on how long a name happened to be, so two
          rows of the same kind never looked alike on a phone. */}
      <span className="flex flex-col items-start gap-y-1">
        <StatusChip status={{ ...status, explanation: undefined }} />
        {subject && (
          <span className="min-w-0 max-w-full truncate text-[0.9375rem] font-medium text-ink">
            {subject.name}
          </span>
        )}
      </span>
      {explanation && (
        <span className="mt-0.5 block text-[0.8125rem] text-muted-fg">
          {explanation}
        </span>
      )}
    </span>
  );

  return (
    <li className="px-4 py-3 sm:px-5">
      {href ? (
        // The whole row is the target, so a thumb has the full width.
        <Link
          href={href}
          transitionTypes={["nav-forward"]}
          className="group -my-1 flex min-h-11 items-center justify-between gap-3 py-1"
        >
          {body}
          <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted-fg/60 transition-colors group-hover:text-brand" />
        </Link>
      ) : (
        body
      )}
    </li>
  );
}
