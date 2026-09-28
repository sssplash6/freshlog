import { PersonBadge } from "@/components/person-chip";
import { ChevronRightIcon } from "@/components/icons";
import { NOTIFICATION_META } from "@/lib/constants";
import { formatAgo } from "@/lib/format";
import { cn } from "@/lib/cn";

const TONE: Record<string, string> = {
  brand: "bg-brand-soft text-brand",
  accent: "bg-accent-soft text-accent-ink",
  plan: "bg-canvas text-muted-fg",
  success: "bg-canvas text-muted-fg",
  warning: "bg-warn-soft text-warn-ink",
};

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
 * One notification as a row. The row IS the button: submitting marks it read
 * and follows its href, so reading and acting are a single gesture rather than
 * a "mark read" chore sitting next to a separate link.
 *
 * Unread rows carry a filled dot and a tinted ground; read ones fade back but
 * stay clickable, because "where was that thing again" is a real reason to
 * revisit an old notice.
 */
function NotificationRow({
  notification: n,
  index,
}: {
  notification: FeedNotification;
  index: number;
}) {
  const meta = NOTIFICATION_META[n.type] ?? { label: "Update", tone: "brand" };

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
        className={cn(
          "group flex w-full items-start gap-3 px-4 py-2 text-left transition-colors sm:px-5",
          n.read
            ? "hover:bg-canvas active:bg-canvas"
            : "bg-brand-soft/40 hover:bg-brand-soft/70 active:bg-brand-soft/70",
        )}
      >
          <span
            aria-hidden="true"
            className={cn(
              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
              n.read ? "bg-transparent" : "bg-brand",
            )}
          />
          {/* The dot is the only mark of an unread row, and it is drawn, not
              said — so the row says it first, where a screen reader starts. */}
          {!n.read && <span className="sr-only">Unread, </span>}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.06em]",
                  TONE[meta.tone],
                )}
              >
                {meta.label}
              </span>
              {n.actor && <PersonBadge person={n.actor} className="h-5 w-5 text-[0.5625rem]" />}
              <span className="text-xs text-muted-fg">
                {formatAgo(n.createdAt)}
              </span>
            </span>
            <span
              className={cn(
                "mt-1.5 block text-[0.9375rem]",
                n.read ? "text-muted-fg" : "font-medium text-ink",
              )}
            >
              {n.message}
            </span>
          </span>
          {n.href && (
            <ChevronRightIcon className="mt-1 h-4 w-4 shrink-0 text-muted-fg/70 transition-colors group-hover:text-brand" />
          )}
      </a>
    </li>
  );
}

/**
 * The rows on their own, for a caller that already owns the list around them.
 *
 * The homes render the feed inside the Notifications section, under a rule
 * that section draws itself — so they need the `<li>`s, not a second `<ul>`
 * and a second "Earlier" heading.
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
 */
export function NotificationList({
  notifications,
}: {
  notifications: FeedNotification[];
}) {
  const unread = notifications.filter((n) => !n.read);
  const read = notifications.filter((n) => n.read);

  return (
    <>
      {unread.length > 0 && (
        <ul className="divide-y divide-line/60">
          {unread.map((n, i) => (
            <NotificationRow key={n.id} notification={n} index={i} />
          ))}
        </ul>
      )}
      {read.length > 0 && (
        <>
          {unread.length > 0 && (
            <div className="border-y border-line bg-canvas px-4 py-2 text-[0.625rem] font-bold uppercase tracking-[0.08em] text-muted-fg sm:px-5">
              Earlier
            </div>
          )}
          <ul className="divide-y divide-line/60">
            {read.map((n, i) => (
              <NotificationRow key={n.id} notification={n} index={i} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
