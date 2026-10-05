import Link from "next/link";

import { BellIcon } from "@/components/icons";
import { NavCount } from "@/components/nav-links";
import { Popover } from "@/components/ui/popover";
import { NOTIFICATION_META } from "@/lib/constants";
import { formatAgo } from "@/lib/format";
import { unreadLabel, type UnreadSummary } from "@/lib/unread";

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
  unread: UnreadSummary;
  recent: BellNotification[];
  /** One instant for every "3h ago" in the panel. */
  now: Date;
}) {
  return (
    <Popover
      label={unreadLabel(unread)}
      origin="end"
      width="lg"
      triggerClassName="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-fg transition hover:bg-fill hover:text-ink data-[open]:bg-fill data-[open]:text-ink"
      trigger={
        <>
          <BellIcon className="h-[1.125rem] w-[1.125rem]" />
          {unread.total > 0 && (
            // Brand blue: unread mail is not a problem, and red is spent in
            // this app on hours that are gone and balances that are negative.
            <span className="absolute -right-2 -top-2">
              <NavCount count={unread.total} />
            </span>
          )}
        </>
      }
    >
      <div className="flex items-baseline justify-between gap-3 px-3 pb-2">
        <span className="text-[0.9375rem] font-semibold text-ink">Notifications</span>
        {unread.total > 0 && (
          <span className="text-xs tabular-nums text-muted-fg">
            {unread.total} unread
          </span>
        )}
      </div>

      {/* What the number is made of, deadlines first: 157 unread is mostly
          session logs, and the three that have a clock on them should not have
          to be found among them. Each chip opens that category's feed. */}
      {unread.parts.length > 1 && (
        <ul className="flex flex-wrap gap-1.5 px-3 pb-2">
          {unread.parts.map((p) => (
            <li key={p.category}>
              <Link
                href={`/notifications?category=${p.category}`}
                transitionTypes={["nav-forward"]}
                className={`inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-xs tabular-nums transition-colors hover:bg-fill-strong ${
                  p.category === "DEADLINES"
                    ? "bg-warn-soft font-semibold text-warn-ink"
                    : "bg-fill text-muted-fg"
                }`}
              >
                <span className="font-semibold">{p.count}</span> {p.label.toLowerCase()}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {recent.length === 0 ? (
        <p className="px-3 pb-2 text-sm text-muted-fg">No notices for you.</p>
      ) : (
        <ul className="-mx-1 divide-y divide-line border-y border-line">
          {recent.map((n) => (
            <li key={n.id}>
              <a
                href={`/n/${n.id}`}
                // The row's GET marks it read; warming it would read it early.
                data-no-prefetch
                className="flex items-start gap-2.5 px-4 py-2 transition-colors hover:bg-fill"
              >
                {/* Unread is the dot and the weight, as on the full feed — not a
                    tinted ground, which made a fresh panel a blue slab. */}
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    n.read ? "bg-transparent" : "bg-brand"
                  }`}
                />
                {!n.read && <span className="sr-only">Unread, </span>}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={`line-clamp-2 text-[0.8125rem] text-ink ${
                      n.read ? "" : "font-semibold"
                    }`}
                  >
                    {n.message}
                  </span>
                  <span className="text-xs text-muted-fg">
                    {NOTIFICATION_META[n.type]?.label ?? "Update"}
                    {" · "}
                    <span className="tabular-nums">{formatAgo(n.createdAt, now)}</span>
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="px-3 pt-2">
        <Link
          href="/notifications"
          transitionTypes={["nav-forward"]}
          className="text-xs font-semibold text-brand hover:underline"
        >
          See all
        </Link>
      </div>
    </Popover>
  );
}
