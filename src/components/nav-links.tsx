"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { usePendingHref } from "@/lib/nav-pending";

import {
  CalendarIcon,
  ChartIcon,
  GearIcon,
  HomeIcon,
  InboxIcon,
  LayersIcon,
  StarIcon,
  UserIcon,
  UsersIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";
import type { NavItem } from "@/lib/nav";

/**
 * A shape to aim at, beside the word that carries the meaning.
 *
 * Resolved from the HREF rather than stored on `NavItem`, because `lib/nav.ts`
 * is `server-only` and an icon is a component — and because one of these items
 * is a PROGRAM'S OWN NAME, which no map keyed on a label could ever cover. The
 * href is the thing every item actually has.
 *
 * Longest prefix wins, the same rule `useCurrentNavItem` uses, so
 * `/student/interviews` is two people rather than a house. Anything unmatched
 * gets the program mark: the only unlisted hrefs are `/programs/:id`.
 */
const NAV_ICONS: [string, (p: { className?: string }) => React.ReactNode][] = [
  ["/student/interviews", UsersIcon],
  // A calendar, not a plus: the page is a list of mentors to book a time
  // with, and a "+" promised a form that creates something.
  ["/student/book", CalendarIcon],
  ["/student/feedback", StarIcon],
  ["/student", HomeIcon],
  // Both homes are HomeIcon now that their pages are titled "Home" — the
  // inbox glyph stays with /notifications, the page that actually is one.
  ["/admin", HomeIcon],
  ["/mentor", HomeIcon],
  ["/students", UsersIcon],
  ["/mentors", UserIcon],
  ["/programs", LayersIcon],
  ["/sessions", CalendarIcon],
  ["/analytics", ChartIcon],
  ["/feedback", StarIcon],
  ["/notifications", InboxIcon],
  ["/settings", GearIcon],
];

export function NavIcon({ href, className }: { href: string; className?: string }) {
  const hit = NAV_ICONS.filter(([prefix]) => href === prefix || href.startsWith(`${prefix}/`))
    .sort((a, b) => b[0].length - a[0].length)[0];
  const Icon = hit ? hit[1] : LayersIcon;
  return <Icon className={className} />;
}

/**
 * Which item the reader is standing on.
 *
 * Longest matching href wins, so `/admin/students/[id]` lights Students rather
 * than Home — `/admin` is a prefix of every admin route and would otherwise
 * claim all of them. Shared by all three renderings below and by the tab bar,
 * because a sidebar and a bottom bar that disagreed about where you are would
 * be worse than either alone.
 *
 * An item may carry a query — an institute's levels are one program page each
 * narrowed by `?level=` — and then it matches only where every parameter it
 * names holds, the rule `TabLinks` uses. Longest href still wins, so a level
 * outranks the "All levels" item on the same path.
 */
export function useCurrentNavItem(items: NavItem[]): NavItem | null {
  // Where a tap is heading wins over where the router still is, so the
  // highlight moves on touch (see lib/nav-pending.ts) — one item lit, never
  // the old one and the new one together.
  const pending = usePendingHref();
  const current = usePathname();
  const params = useSearchParams();
  const pathname = pending ?? current;
  return items.reduce<NavItem | null>((best, item) => {
    const [path, query = ""] = item.href.split("?");
    const matches = pathname === path || pathname.startsWith(`${path}/`);
    if (!matches) return best;
    for (const [key, value] of new URLSearchParams(query)) {
      if (params.get(key) !== value) return best;
    }
    if (!best || item.href.length > best.href.length) return item;
    return best;
  }, null);
}

/**
 * The count beside Home and Notifications, and nowhere else.
 *
 * Brand blue, not red. Unread mail is not a problem — red in this app means
 * hours are gone or a balance is negative (DESIGN.md), and spending it on a
 * number that is usually non-zero is how a reader learns to stop seeing red.
 */
export function NavCount({ count, muted }: { count: number; muted?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[0.75rem] font-bold tabular-nums",
        muted ? "bg-fill text-muted-fg" : "bg-brand text-on-brand"
      )}
    >
      <span key={count} className="badge-pop inline-flex">
        {count > 99 ? "99+" : count}
      </span>
    </span>
  );
}

/**
 * Inline text links in a top bar. The student shell's only nav at ≥ md, where
 * four items fit a row and a bottom bar would be a phone habit on a laptop.
 */
export function NavLinks({ items }: { items: NavItem[] }) {
  const current = useCurrentNavItem(items);
  return (
    <>
      {items.map((item) => {
        const active = item === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            // Full prefetch: a handful of links on every page, so a tap renders
            // from cache with no skeleton at all (see NativeGestures for rows).
            prefetch
            aria-current={active ? "page" : undefined}
            className={cn(
              // The selected item is a tinted pill, the rail's own shape laid
              // on its side — not a 2px underline, which is a web tab strip's
              // tell and was the only underline in the chrome.
              "inline-flex min-h-9 items-center rounded-full px-3 text-[0.9375rem] transition-colors",
              active
                ? "bg-brand-soft font-semibold text-brand"
                : "font-medium text-muted-fg hover:bg-fill hover:text-ink"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

/**
 * The sidebar's rows: a label, and for two of them a number.
 *
 * Text, never an icon alone. An icon rail buys back 160px of a 1280px screen
 * and charges for it in a guess per item — and the items here are Students,
 * Mentors and a program's own name, three things no icon distinguishes.
 *
 * `utility` is rendered under a rule as the same kind of row. It is a separate
 * argument rather than a second `<SidebarNav>` so that "which item am I on"
 * is decided once, over every item in the column.
 */
export function SidebarNav({
  items,
  utility = [],
}: {
  items: NavItem[];
  utility?: NavItem[];
}) {
  const current = useCurrentNavItem([...items, ...utility]);

  const row = (item: NavItem) => {
    const active = item === current;
    return (
      <Link
        key={item.href}
        href={item.href}
        // Full prefetch: a handful of links on every page, so a tap renders
        // from cache with no skeleton at all (see NativeGestures for rows).
        prefetch
        aria-current={active ? "page" : undefined}
        // `title` is what a collapsed rail leaves a reader: the label is
        // display:none there, so the browser's own tooltip is the label.
        title={item.label}
        className={cn(
          // 40px: the rail exists only at lg, under a pointer, where 44 is not
          // the floor it is on a phone — and six 44px rows read as a list of
          // buttons rather than a sidebar. 15px labels, a 20px glyph.
          "relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-[0.9375rem] transition-colors",
          // Shut: the mark alone, centred. Peeking: the row it always was.
          "rail-collapsed:justify-center rail-collapsed:px-0",
          "rail-collapsed:group-hover/rail:justify-start rail-collapsed:group-hover/rail:px-3",
          active
            ? "bg-brand-soft font-semibold text-brand before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand"
            : "font-medium text-ink hover:bg-fill"
        )}
      >
        <NavIcon
          href={item.href}
          className={cn("h-5 w-5 shrink-0", active ? "text-brand" : "text-muted-fg")}
        />
        {/* A program's name is the one label that can be long, and it takes a
            second line rather than sliding out of view. */}
        <span className="min-w-0 flex-1 rail-collapsed:hidden rail-collapsed:group-hover/rail:block">
          {item.label}
        </span>
        {item.count != null && item.count > 0 && (
          <span className="rail-collapsed:hidden rail-collapsed:group-hover/rail:block">
            <NavCount count={item.count} muted={active} />
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {items.map((item, i) =>
        // A heading over the first item of each run sharing a group. Hidden
        // when the rail is shut: a heading is words, and a shut rail is marks.
        item.group && item.group !== items[i - 1]?.group ? (
          <div key={item.href} className="flex flex-col gap-0.5">
            <p className="px-3 pt-3 text-[0.8125rem] font-medium text-muted-fg rail-collapsed:hidden rail-collapsed:group-hover/rail:block">
              {item.group}
            </p>
            {row(item)}
          </div>
        ) : (
          row(item)
        )
      )}
      {utility.length > 0 && (
        <>
          {/* Space, not a rule: iOS separates a sidebar's sections with air,
              and a hairline across the rail was a second border beside the
              one on its edge. */}
          <div aria-hidden="true" className="h-5" />
          {utility.map(row)}
        </>
      )}
    </nav>
  );
}
