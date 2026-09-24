"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  CalendarIcon,
  ChartIcon,
  GearIcon,
  HomeIcon,
  InboxIcon,
  LayersIcon,
  PlusIcon,
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
 * `/student/meetings` is a calendar rather than a house. Anything unmatched
 * gets the program mark: the only unlisted hrefs are `/programs/:id`.
 */
const NAV_ICONS: [string, (p: { className?: string }) => React.ReactNode][] = [
  ["/student/meetings", CalendarIcon],
  ["/student/book", PlusIcon],
  ["/student/feedback", StarIcon],
  ["/student", HomeIcon],
  ["/admin", InboxIcon],
  ["/mentor", InboxIcon],
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
 * than Inbox — `/admin` is a prefix of every admin route and would otherwise
 * claim all of them. Shared by all three renderings below and by the tab bar,
 * because a sidebar and a bottom bar that disagreed about where you are would
 * be worse than either alone.
 */
export function useCurrentNavItem(items: NavItem[]): NavItem | null {
  const pathname = usePathname();
  return items.reduce<NavItem | null>((best, item) => {
    const matches =
      pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!matches) return best;
    if (!best || item.href.length > best.href.length) return item;
    return best;
  }, null);
}

/**
 * The count beside Inbox and Notifications, and nowhere else.
 *
 * Brand blue, not red. Unread mail is not a problem — red in this app means
 * hours are gone or a balance is negative (DESIGN.md), and spending it on a
 * number that is usually non-zero is how a reader learns to stop seeing red.
 */
export function NavCount({ count, muted }: { count: number; muted?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[0.6875rem] font-bold tabular-nums",
        muted ? "bg-canvas text-muted-fg" : "bg-brand text-on-brand"
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
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center border-b-2 px-1 text-sm transition-colors",
              active
                ? "border-brand font-semibold text-ink"
                : "border-transparent text-muted-fg hover:text-ink"
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
        aria-current={active ? "page" : undefined}
        // `title` is what a collapsed rail leaves a reader: the label is
        // display:none there, so the browser's own tooltip is the label.
        title={item.label}
        className={cn(
          "flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors",
          // Shut: the mark alone, centred. Peeking: the row it always was.
          "rail-collapsed:justify-center rail-collapsed:px-0",
          "rail-collapsed:group-hover/rail:justify-start rail-collapsed:group-hover/rail:px-3",
          active
            ? "bg-brand-soft font-semibold text-brand"
            : "font-medium text-muted-fg hover:bg-canvas hover:text-ink"
        )}
      >
        <NavIcon href={item.href} className="h-4 w-4 shrink-0" />
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
      {items.map(row)}
      {utility.length > 0 && (
        <>
          <hr className="my-2 border-line" />
          {utility.map(row)}
        </>
      )}
    </nav>
  );
}
