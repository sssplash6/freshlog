import type { NavItem } from "@/lib/nav";

/**
 * Which nav item a path stands on: the longest matching href wins, so
 * `/admin/students/[id]` lights Students rather than Home, and an item that
 * carries a query (`?level=`) matches only where every parameter it names
 * holds.
 *
 * Pure, and kept apart from the hooks in components/nav-links.tsx, because the
 * same rule answers two different questions there and confusing them broke
 * every tab in the phone bar (October 2026): which item to LIGHT, asked of
 * where a tap is heading, and whether a tap is a RE-TAP, asked of where the
 * router actually is. See `useLandedNavItem`.
 */
export function matchNavItem(
  items: NavItem[],
  pathname: string,
  params: URLSearchParams
): NavItem | null {
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
