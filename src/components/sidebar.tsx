import pkg from "../../package.json";
import { BrandWordmark } from "@/components/brand-wordmark";
import { NavSearch } from "@/components/nav-search";
import { SidebarNav } from "@/components/nav-links";
import type { NavItem } from "@/lib/nav";

/**
 * The staff column at ≥ lg: 220px, fixed, labelled.
 *
 * It replaces a horizontal bar that had run out of room by its own admission —
 * "Four things do not fit a 320px row" was a comment in the file it replaces —
 * and that had no entry at all for Programs, Sessions or Notifications. A
 * vertical column is not a style choice: items here are added by a grant, so
 * the number of them is data, and a row that overflows at six is the wrong
 * container for a list whose length nobody controls.
 *
 * 220px against a `max-w-6xl` page, which is the reason the main column widened
 * from 5xl in the same commit: the rail has to come out of the window's margins
 * rather than out of the table beside it.
 */
export function Sidebar({
  items,
  utility,
  switcher,
  search,
  account,
  place,
}: {
  items: NavItem[];
  /**
   * The institute this reader works in, under the wordmark — absent for
   * everybody in the school frame (lib/space.ts).
   */
  place?: React.ReactNode;
  /** Rendered under the items, after a gap — Settings. */
  utility?: NavItem[];
  /** The Admin | Mentor control. Absent for everybody with one lens. */
  switcher?: React.ReactNode;
  /** Omitted for a viewer with no list to search. `mentors` adds the second destination. */
  search?: { mentors: boolean };
  account: React.ReactNode;
}) {
  return (
    <aside className="vt-rail fixed inset-y-0 left-0 z-30 hidden w-[13.75rem] flex-col border-r border-line bg-surface/80 shadow-rail backdrop-blur-xl backdrop-saturate-150 lg:flex">
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-5">
        <div className="flex flex-col gap-3 px-1">
          <BrandWordmark version={pkg.version} />
          {place}
          {switcher}
        </div>
        {search && <NavSearch mentors={search.mentors} />}
        <SidebarNav items={items} utility={utility} />
      </div>
      <div className="border-t border-line/60 p-2">{account}</div>
    </aside>
  );
}
