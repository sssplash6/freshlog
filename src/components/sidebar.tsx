import Link from "next/link";

import { SearchIcon } from "@/components/icons";
import { SidebarNav } from "@/components/nav-links";
import { RailToggle } from "@/components/rail-toggle";
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
}: {
  items: NavItem[];
  /** Rendered under a rule — Notifications, and later Settings. */
  utility?: NavItem[];
  /** The Admin | Mentor control. Absent for everybody with one lens. */
  switcher?: React.ReactNode;
  /** Omitted for a viewer with no list to search. `mentors` adds the second destination. */
  search?: { mentors: boolean };
  account: React.ReactNode;
}) {
  return (
    // A SHUT RAIL OPENS WHILE THE CURSOR IS ON IT, and shuts again when it
    // leaves. Every `rail-collapsed:` below has a `rail-collapsed:group-hover`
    // twin putting it back, so the peek is the open rail rather than a third
    // state somebody has to maintain.
    //
    // The page does NOT move: the aside is `fixed` and the wrapper's padding
    // follows `data-rail` alone, so the rail slides out over the content with a
    // shadow under it. Widening the page instead would reflow a table under the
    // reader's cursor every time they crossed the left edge of the window.
    <aside className="group/rail fixed inset-y-0 left-0 z-30 hidden w-[13.75rem] flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex rail-collapsed:w-16 rail-collapsed:hover:w-[13.75rem] rail-collapsed:hover:shadow-lg">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-5 rail-collapsed:px-2 rail-collapsed:group-hover/rail:px-3">
        <div className="flex flex-col gap-3 px-1 rail-collapsed:px-0 rail-collapsed:group-hover/rail:px-1">
          {/* The wordmark and the toggle share the top line, and the wordmark
              is what gives way when the rail shuts: the control that reopens
              it has to survive being collapsed, or there is no way back. */}
          <div className="flex items-center justify-between gap-2 rail-collapsed:justify-center rail-collapsed:group-hover/rail:justify-between">
            <Link
              href="/"
              className="text-base font-bold tracking-tight text-brand rail-collapsed:hidden rail-collapsed:group-hover/rail:block"
            >
              freshlog
            </Link>
            <RailToggle />
          </div>
          <div className="rail-collapsed:hidden rail-collapsed:group-hover/rail:block">
            {switcher}
          </div>
        </div>
        <div className="rail-collapsed:hidden rail-collapsed:group-hover/rail:block">
          {search && <NavSearch mentors={search.mentors} />}
        </div>
        <SidebarNav items={items} utility={utility} />
      </div>
      <div className="border-t border-line p-2 rail-collapsed:hidden rail-collapsed:group-hover/rail:block">
        {account}
      </div>
    </aside>
  );
}

/**
 * One field, one destination, no JavaScript.
 *
 * It offered two — "Students" and "Mentors" as tiny submits under the box —
 * and they sat directly above nav items reading Students and Mentors. The same
 * two words twice in eight vertical pixels, once as a destination picker and
 * once as navigation, is a question the reader has to stop and answer.
 *
 * So the field goes to the students list, which is the one people search: it is
 * an order of magnitude longer, and it is what somebody typing a person's name
 * into a sidebar almost always means. Mentors are one click below with their
 * own search at the top of the page, which is where searching a list of
 * fourteen belongs anyway.
 */
function NavSearch({ mentors }: { mentors: boolean }) {
  // `mentors` still decides the wording: somebody who cannot see the mentors
  // list should not be told this box could find one.
  return (
    <form method="get" action="/students" role="search">
      <label htmlFor="nav-search" className="sr-only">
        {mentors ? "Find a student or mentor" : "Find a student"}
      </label>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-fg" />
        <input
          id="nav-search"
          name="q"
          type="search"
          placeholder={mentors ? "Find a student or mentor…" : "Find a student…"}
          className="w-full rounded-lg border border-line bg-canvas py-2 pl-8 pr-2 text-sm text-ink placeholder:text-muted-fg focus:border-brand focus:outline-none"
        />
      </div>
    </form>
  );
}
