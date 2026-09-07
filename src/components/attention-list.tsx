import Link from "next/link";

import { ArrowRightIcon, BellIcon } from "@/components/icons";
import {
  NotificationRows,
  type FeedNotification,
} from "@/components/notification-list";
import { Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/cn";
import { DismissStatus } from "@/components/forms/dismiss-status";
import { actionableCount, type Status } from "@/lib/status";

/**
 * "Notifications" — the one section every home opens with.
 *
 * It was called "Needs you", and the owner still had to ask what was in it. It
 * is the same rows, under the name the bell in the chrome already uses, with
 * that bell drawn beside the heading so the two read as one thing. The feed
 * comes with it: what needs you now, then a rule, then what has happened —
 * because a separate `/notifications` page was a second place to look for the
 * same idea, and nobody had a reason to go there. That page survives as the
 * archive, linked from the bottom of this section.
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
/**
 * The name the bell in the chrome uses. A section carrying it is the feed's
 * home, and gets the bell, the anchor and the "Earlier" rule; a subject page's
 * "Needs attention" is a list about that subject and gets none of them.
 */
const FEED_TITLE = "Notifications";

export function AttentionList({
  statuses,
  title = FEED_TITLE,
  /** Rendered when nothing needs the viewer. `ALL_CLEAR` covers most cases. */
  empty,
  /** A row's own action — Approve, an RSVP — keyed by status type. */
  renderAction,
  dismissible = false,
  feed,
  feedHref = "/notifications",
  moreHref,
  moreLabel,
  className,
}: {
  statuses: Status[];
  title?: string;
  /**
   * What has already happened, under "Earlier". The homes pass their most
   * recent rows; the full history stays at `feedHref`.
   */
  feed?: FeedNotification[];
  feedHref?: string;
  empty?: React.ReactNode;
  renderAction?: (status: Status) => React.ReactNode;
  /**
   * Offer "don't show me this again" per row.
   *
   * For the inboxes, where a row that cannot resolve itself otherwise sits
   * there forever. Not for a single entity's page, where the list is short,
   * scoped to what you are looking at, and hiding a row would hide it from the
   * one screen that explains it.
   */
  dismissible?: boolean;
  moreHref?: string;
  moreLabel?: string;
  className?: string;
}) {
  const count = actionableCount(statuses);
  const isFeed = title === FEED_TITLE;

  return (
    <Section
      // The bell in the chrome links here. `scroll-mt` keeps the heading clear
      // of the sticky top bar when it does.
      {...(isFeed ? { id: "notifications" } : {})}
      title={
        isFeed ? (
          <span className="inline-flex items-center gap-2">
            <BellIcon className="h-[18px] w-[18px] shrink-0 text-muted-fg" />
            {title}
          </span>
        ) : (
          title
        )
      }
      count={count > 0 ? count : undefined}
      className={cn(isFeed && "scroll-mt-20", className)}
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
          // list. `Timeline` already does this; this side did not, so a mentor
          // with twelve things needing them saw ten and no hint of the rest.
          <span className="text-xs text-muted-fg">{moreLabel}</span>
        ) : undefined
      }
    >
      {statuses.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-fg sm:px-5">
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

      {/* What has already happened. A rule and a word, not a second card:
          "needs you" and "has happened" are two halves of one question, and
          they were two addresses. */}
      {feed && feed.length > 0 && (
        <>
          <div className="flex items-baseline justify-between gap-4 border-t border-line bg-canvas px-4 py-2 sm:px-5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-fg">
              Earlier
            </span>
            <Link
              href={feedHref}
              className="text-xs font-medium text-brand hover:underline"
            >
              All notifications
            </Link>
          </div>
          <ul className="divide-y divide-line">
            <NotificationRows notifications={feed} />
          </ul>
        </>
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
        <span className="mt-1 block text-[13px] text-muted-fg">{explanation}</span>
      )}
      {program && (
        <span className="mt-0.5 block text-xs text-muted-fg">{program.name}</span>
      )}
    </>
  );

  return (
    <li className="group/row flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
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

/** For a card that is not a whole section — a student's page, a program overview. */
export function AttentionRows({ statuses }: { statuses: Status[] }) {
  if (statuses.length === 0) return null;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      {statuses.map((s, i) => (
        <AttentionRow key={`${s.type}-${s.subject?.id ?? i}`} status={s} />
      ))}
    </ul>
  );
}
