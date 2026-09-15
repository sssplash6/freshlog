import Link from "next/link";

import { ArrowRightIcon } from "@/components/icons";
import { Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/cn";
import { DismissStatus } from "@/components/forms/dismiss-status";
import { actionableCount, type Status } from "@/lib/status";

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

  return (
    <Section
      title={title}
      count={count > 0 ? count : undefined}
      className={className}
      action={
        moreHref ? (
          <Link
            href={moreHref}
            className="text-xs font-medium text-brand hover:underline"
          >
            {moreLabel ?? "See all"}
          </Link>
        ) : moreLabel ? (
          // A label with nowhere to go still has something to say: a capped
          // list that discards its eleventh row in silence reads as a complete
          // list.
          <span className="text-xs text-muted-fg">{moreLabel}</span>
        ) : undefined
      }
    >
      {statuses.length === 0 ? (
        <p className="px-4 py-2 text-sm text-muted-fg sm:px-5">
          {empty ?? "Nothing needs you."}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {statuses.map((s, i) => (
            <AttentionRow
              key={`${s.type}-${s.subject?.id ?? i}`}
              status={s}
              action={renderAction?.(s)}
              dismissible={dismissible}
            />
          ))}
        </ul>
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

  const body = (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <StatusChip status={{ ...status, explanation: undefined }} />
        {subject && (
          <span className="min-w-0 truncate font-medium text-ink">{subject.name}</span>
        )}
        
      </span>
      {explanation && (
        <span className="mt-1 block text-[0.8125rem] text-muted-fg">{explanation}</span>
      )}
      {program && (
        <span className="mt-0.5 block text-xs text-muted-fg">{program.name}</span>
      )}
    </>
  );

  return (
    <li className="group/row flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-5">
      {href && !action ? (
        // The row is the target. `min-w-0` so the subject's truncate works;
        // without it the name sets the width and pushes the arrow off.
        <Link
          href={href}
          className="group -my-1 flex min-w-0 flex-1 items-center justify-between gap-3 py-1"
        >
          <span className="min-w-0">{body}</span>
          <ArrowRightIcon className="h-4 w-4 shrink-0 text-muted-fg transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
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
