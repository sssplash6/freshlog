import { PersonBadge } from "@/components/person-chip";
import { ChevronRightIcon } from "@/components/icons";
import { Section } from "@/components/ui/section";
import { NOTIFICATION_META } from "@/lib/constants";
import { formatAgo } from "@/lib/format";
import { cn } from "@/lib/cn";

export type FeedNotification = {
  id: string;
  type: string;
  message: string;
  href: string | null;
  read: boolean;
  createdAt: Date;
  actor: { id: string; name: string | null; email: string } | null;
};

/**
 * One notification as a row. The row IS the button: following it marks it read
 * and goes to its href, so reading and acting are a single gesture rather than
 * a "mark read" chore sitting next to a separate link.
 *
 * The message is the line that matters, so it goes first; what kind of notice
 * it is and when it came are the quiet line under it. The kind used to be a
 * tinted tag in one of five colours — brand, accent, amber — which spent the
 * status hues and the hours orange on a label, and made a feed of facts look
 * like a feed of alarms. It is a word in muted grey now.
 *
 * Unread is a brand dot and a semibold message, nothing more: no tinted ground,
 * so a page of unread rows is not a blue slab.
 */
function NotificationRow({
  notification: n,
  index,
}: {
  notification: FeedNotification;
  index: number;
}) {
  const meta = NOTIFICATION_META[n.type] ?? { label: "Update" };

  return (
    <li
      className="deal-in"
      style={{ animationDelay: `${Math.min(index, 12) * 24}ms` }}
    >
      {/*
        A plain anchor, deliberately NOT `next/link`: `/n/[id]` marks the row
        read as its side effect, and `<Link>` prefetches on hover — which
        executes the handler, so a reader who merely scrolled past a row would
        find it already read. `<a>` is also why this is no longer a form: the
        route handler owns the mutation and the per-reader redirect, so the row
        does not need to submit anything.
      */}
      <a
        href={`/n/${n.id}`}
        // The gesture layer prefetches on touch-down too — same reason, so
        // same guard.
        data-no-prefetch
        className="group flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-fill active:bg-fill sm:px-5"
      >
        <span
          aria-hidden="true"
          className={cn(
            "mt-[0.4375rem] h-2 w-2 shrink-0 rounded-full",
            n.read ? "bg-transparent" : "bg-brand",
          )}
        />
        {/* The dot is the only mark of an unread row, and it is drawn, not
            said — so the row says it first, where a screen reader starts. */}
        {!n.read && <span className="sr-only">Unread, </span>}
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[0.9375rem] leading-snug text-ink",
              n.read ? "font-normal" : "font-semibold",
            )}
          >
            {n.message}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[0.8125rem] text-muted-fg">
            {n.actor && (
              <PersonBadge person={n.actor} className="h-4 w-4 text-[0.5rem]" />
            )}
            <span>{meta.label}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{formatAgo(n.createdAt)}</span>
          </span>
        </span>
        {n.href && (
          <ChevronRightIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-fg/60 transition-colors group-hover:text-brand" />
        )}
      </a>
    </li>
  );
}

/**
 * The rows on their own, for a caller that already owns the list around them.
 */
export function NotificationRows({
  notifications,
}: {
  notifications: FeedNotification[];
}) {
  return (
    <>
      {notifications.map((n, i) => (
        <NotificationRow key={n.id} notification={n} index={i} />
      ))}
    </>
  );
}

/**
 * The feed, split into what's new and what's been seen. Splitting beats one
 * merged list sorted by date: the unread group is the reason anyone opens this
 * page, and it should not be interleaved with things already dealt with.
 *
 * Two groups, each its own titled card, the way a grouped list splits — not
 * one card with a grey "Earlier" band through the middle of it, which was a
 * header lid inside a card. `newAction` sits in the first group's header
 * ("Mark all read"); `footer` closes the last card (the pager).
 */
export function NotificationList({
  notifications,
  newAction,
  footer,
}: {
  notifications: FeedNotification[];
  newAction?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const unread = notifications.filter((n) => !n.read);
  const read = notifications.filter((n) => n.read);

  return (
    <>
      {unread.length > 0 && (
        <Section title="New" count={unread.length} action={newAction}>
          <ul className="divide-y divide-line">
            {unread.map((n, i) => (
              <NotificationRow key={n.id} notification={n} index={i} />
            ))}
          </ul>
          {read.length === 0 && footer}
        </Section>
      )}
      {read.length > 0 && (
        <Section title="Earlier">
          <ul className="divide-y divide-line">
            {read.map((n, i) => (
              <NotificationRow key={n.id} notification={n} index={i} />
            ))}
          </ul>
          {footer}
        </Section>
      )}
    </>
  );
}
