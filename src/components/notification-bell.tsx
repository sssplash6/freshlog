import Link from "next/link";

import { BellIcon } from "@/components/icons";
import { NavCount } from "@/components/nav-links";
import { Popover } from "@/components/ui/popover";
import { NOTIFICATION_META } from "@/lib/constants";
import { formatAgo } from "@/lib/format";

/**
 * The bell, and the last few things behind it.
 *
 * Notifications were a row in the sidebar, which put "what has happened" in the
 * same column as "where can I go" — and made the one item that changes on its
 * own look like a place. A bell in the corner is what people already reach for,
 * and the corner is the same on every page whether or not the rail is open.
 *
 * SIX rows, then a way to the rest. The panel is a glance: enough to see
 * whether the thing you were waiting for has landed, and no attempt to be the
 * page — `/notifications` is the page, it has the filters and the whole feed,
 * and "See all" is one press from here.
 *
 * Plain anchors, not `next/link`, for the reason `NotificationList` records:
 * `/n/[id]` marks a row read as its side effect, and `<Link>` prefetches on
 * hover — so a reader who merely moved the cursor down the panel would find
 * everything in it already read.
 */
export type BellNotification = {
  id: string;
  type: string;
  message: string;
  read: boolean;
  createdAt: Date;
};

export function NotificationBell({
  unread,
  recent,
  now,
}: {
  unread: number;
  recent: BellNotification[];
  /** One instant for every "3h ago" in the panel. */
  now: Date;
}) {
  return (
    <Popover
      label={`Notifications (${unread} unread)`}
      origin="end"
      width="lg"
      triggerClassName="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted-fg shadow-sm transition hover:bg-brand-soft hover:text-brand data-[open]:bg-brand-soft data-[open]:text-brand"
      trigger={
        <>
          <BellIcon className="h-[1.125rem] w-[1.125rem]" />
          {unread > 0 && (
            // Brand blue: unread mail is not a problem, and red is spent in
            // this app on hours that are gone and balances that are negative.
            <span className="absolute -right-0.5 -top-0.5">
              <NavCount count={unread} />
            </span>
          )}
        </>
      }
    >
      <div className="flex items-baseline justify-between gap-3 px-3 pb-2">
        <span className="text-sm font-bold text-ink">Notifications</span>
        {unread > 0 && (
          <span className="text-xs tabular-nums text-muted-fg">{unread} unread</span>
        )}
      </div>

      {recent.length === 0 ? (
        <p className="px-3 pb-2 text-sm text-muted-fg">No notices for you.</p>
      ) : (
        <ul className="-mx-1 border-y border-line">
          {recent.map((n) => (
            <li key={n.id}>
              <a
                href={`/n/${n.id}`}
                className={`flex flex-col gap-0.5 px-4 py-2 transition-colors hover:bg-canvas ${
                  n.read ? "" : "bg-brand-soft/40"
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.07em] text-muted-fg">
                    {NOTIFICATION_META[n.type]?.label ?? "Update"}
                  </span>
                  <span className="shrink-0 text-[0.6875rem] tabular-nums text-muted-fg">
                    {formatAgo(n.createdAt, now)}
                  </span>
                </span>
                <span className="line-clamp-2 text-[0.8125rem] text-ink">
                  {n.message}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="px-3 pt-2">
        <Link
          href="/notifications"
          className="text-xs font-semibold text-brand hover:underline"
        >
          See all
        </Link>
      </div>
    </Popover>
  );
}
