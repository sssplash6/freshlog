import Link from "next/link";

import { CheckIcon, ChevronRightIcon } from "@/components/icons";
import { Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/cn";
import { DismissStatus } from "@/components/forms/dismiss-status";
import {
  actionableCount,
  groupStatuses,
  STATUS_GROUP_LABELS,
  type Status,
} from "@/lib/status";

/**
 * What needs the reader, as rows.
 *
 * It opened every home page in the app, three times over, under three names —
 * "Notifications", "Needs you", "Needs attention" — and a reader still had to
 * ask what was in it. It renders in exactly one place now: `/notifications`,
 * behind the bell. A page about a student, a mentor or a program says what is
 * true of that record in its own body; it does not carry a second inbox.
 *
 * It replaces nine things that each did a piece of this job in their own
 * shape and colour: the admin approvals `Callout`, the orange "N mentors
 * awaiting assignment" pill, the `flagsFor` panel, four red student
 * `Callout`s, the UNASSIGNED welcome card, and the mentor booking-link pill.
 * A viewer had to learn nine layouts to find out what was wrong, and two of
 * the nine could not be dismissed or acted on at all.
 *
 * Every row is the same three things: what state it is in, what it is about,
 * and what to do. The wording comes from `lib/status.ts`, already in this
 * reader's voice — this file chooses no words and no colours.
 *
 * The count in the header is ACTIONABLE rows only. A mentor waiting on a
 * student's answer has something on screen but nothing to do, and a badge that
 * counts it reads as three jobs when there is one.
 */
export function AttentionList({
  statuses,
  title = "Active issues",
  /** Rendered when nothing needs the viewer. */
  empty,
  /** A row's own action — Approve, an RSVP — keyed by status type. */
  renderAction,
  dismissible = false,
  moreHref,
  moreLabel,
  className,
}: {
  statuses: Status[];
  title?: string;
  empty?: React.ReactNode;
  renderAction?: (status: Status) => React.ReactNode;
  /**
   * Offer "don't show me this again" per row, for the rows that cannot
   * resolve themselves and would otherwise sit there forever.
   */
  dismissible?: boolean;
  moreHref?: string;
  moreLabel?: string;
  className?: string;
}) {
  const count = actionableCount(statuses);
  // Null when the list is short enough, or single-minded enough, that headings
  // would be more furniture than signpost.
  const groups = groupStatuses(statuses);

  const action = moreHref ? (
    <Link
      href={moreHref}
      transitionTypes={["nav-forward"]}
      className="text-[0.8125rem] font-medium text-brand hover:underline"
    >
      {moreLabel ?? "See all"}
    </Link>
  ) : moreLabel ? (
    // A label with nowhere to go still has something to say: a capped list
    // that discards its eleventh row in silence reads as a complete list.
    <span className="text-[0.8125rem] text-muted-fg">{moreLabel}</span>
  ) : undefined;

  const rowsOf = (rows: Status[]) => (
    <ul className="divide-y divide-line">
      {rows.map((s, i) => (
        <AttentionRow
          key={`${s.type}-${s.subject?.id ?? i}`}
          status={s}
          action={renderAction?.(s)}
          dismissible={dismissible}
        />
      ))}
    </ul>
  );

  if (groups) {
    // Grouped, the way a grouped list is: each group its own card under a
    // small caption on the page ground. It used to be one card with grey
    // header bands through it — a lid inside a card, which is the shape the
    // rest of the app gave up. The title and count are `Section`'s, repeated
    // here because `Section` owns exactly one card.
    return (
      <section className={cn("min-w-0 space-y-2", className)}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 pb-0 pt-2">
          <h2 className="flex items-baseline gap-2 text-[1.25rem] font-semibold tracking-[-0.01em] text-ink">
            <span className="min-w-0 truncate">{title}</span>
            {count > 0 && (
              <span className="shrink-0 text-[0.9375rem] font-medium tabular-nums text-muted-fg">
                {count}
              </span>
            )}
          </h2>
          {action}
        </div>
        {groups.map(({ group, rows }) => (
          <div key={group}>
            <h3 className="flex items-baseline gap-1.5 px-4 pb-1.5 pt-1 text-[0.8125rem] text-muted-fg sm:px-5">
              {STATUS_GROUP_LABELS[group]}
              <span className="tabular-nums">{rows.length}</span>
            </h3>
            <div className="overflow-clip rounded-xl bg-surface shadow-sm">
              {rowsOf(rows)}
            </div>
          </div>
        ))}
      </section>
    );
  }

  return (
    <Section
      title={title}
      count={count > 0 ? count : undefined}
      className={className}
      action={action}
    >
      {statuses.length === 0 ? (
        <p className="flex items-baseline gap-1.5 px-4 py-3 text-[0.9375rem] text-muted-fg sm:px-5">
          {/* Inbox zero gets the tick — the one moment "nothing" is the news. */}
          <CheckIcon className="check-draw h-3.5 w-3.5 shrink-0 translate-y-0.5 text-ink/60" />
          {empty ?? "No active issues."}
        </p>
      ) : (
        rowsOf(statuses)
      )}
    </Section>
  );
}

/**
 * One row: chip · subject · why · program · what to do.
 *
 * The whole row is the link when there is nowhere else to click, so a thumb
 * has the full width to hit. When the row carries its own control — Approve,
 * "I'll be there" — the link shrinks to the subject, because a row that both
 * navigates and holds a button is a row where a mis-tap does the wrong thing.
 */
function AttentionRow({
  status,
  action,
  dismissible = false,
}: {
  status: Status;
  action?: React.ReactNode;
  dismissible?: boolean;
}) {
  const { explanation, subject, program, href } = status;

  // Three lines, always in the same order so two rows of the same kind look
  // alike whatever the length of a name: the state (and where), who it is
  // about, why. The chip and the subject side by side wrapped or not
  // depending on the name, and a program on a fourth line of its own made
  // every row a paragraph.
  const body = (
    <>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusChip status={{ ...status, explanation: undefined }} />
        {program && (
          <span className="min-w-0 truncate text-xs text-muted-fg">{program.name}</span>
        )}
      </span>
      {subject && (
        <span className="mt-1 block min-w-0 truncate text-[0.9375rem] font-medium text-ink">
          {subject.name}
        </span>
      )}
      {explanation && (
        <span className="mt-0.5 block text-[0.8125rem] text-muted-fg">{explanation}</span>
      )}
    </>
  );

  // The chevron belongs to the ROW, not to the link inside it: pinned to the
  // row's right padding edge, where a notification's chevron sits, and
  // vertically centred — whether or not a Dismiss button stands to its left.
  const chevron = Boolean(href && !action);

  return (
    <li
      className={cn(
        "group/row relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 transition-colors has-[:active]:bg-fill",
        chevron ? "pl-4 pr-10 sm:pl-5 sm:pr-11" : "px-4 sm:px-5",
      )}
    >
      {chevron && (
        <ChevronRightIcon
          aria-hidden="true"
          className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-fg/60 transition-colors group-hover/row:text-brand sm:right-5"
        />
      )}
      {href && !action ? (
        // The row is the target. `min-w-0` so the subject's truncate works;
        // without it the name sets the width and pushes the chevron off.
        <Link
          href={href}
          transitionTypes={["nav-forward"]}
          className="-my-1 min-w-0 flex-1 py-1"
        >
          {body}
        </Link>
      ) : (
        <span className={cn("min-w-0", action ? "" : "flex-1")}>{body}</span>
      )}
      {(action || dismissible) && (
        <span className="flex shrink-0 items-center gap-2">
          {action}
          {dismissible && (
            <DismissStatus
              type={status.type}
              subjectId={status.subject?.id}
              label={status.label}
            />
          )}
        </span>
      )}
    </li>
  );
}
