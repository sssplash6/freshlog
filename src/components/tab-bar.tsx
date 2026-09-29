"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { MoreHorizontalIcon } from "@/components/icons";
import { NavIcon, useCurrentNavItem } from "@/components/nav-links";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import type { NavItem } from "@/lib/nav";

/**
 * The bottom bar below the sidebar's breakpoint.
 *
 * Visible, not hidden behind a word. What this replaces was a `<details>`
 * labelled "Menu" holding every destination in the app, and NN/g measured
 * hidden navigation at 27% use against 48–50% for visible — on the surface
 * where students and mentors actually are.
 *
 * Four slots, because five 64px targets do not fit a 320px screen with any
 * label left readable. A fifth item and beyond fold into "More", which is the
 * one disclosure kept: an admin lens carries six items and the alternative to a
 * sheet is a bar that scrolls sideways.
 *
 * Icon over label, the shape every phone app shares — a word alone at the
 * bottom of the screen reads as a footer, not as a tab bar. The label still
 * carries the meaning; the mark beside it is the same `NavIcon` the rail
 * draws, so the two navs agree about which glyph is which place.
 */
const SLOTS = 4;

/**
 * An icon with its word. Tinted brand while the page loads, not only after:
 * the tapped tab lights the same instant a native one does (lib/nav-pending)
 * instead of holding the old tab lit for the length of a server round trip.
 */
function TabContent({ item, active }: { item: NavItem; active: boolean }) {
  // `active` already follows the tap: useCurrentNavItem reads the pending
  // destination, so the tapped tab lights at once and the old one goes out.
  const lit = active;
  return (
    <>
      <span className="relative transition-transform group-active:scale-90">
        <NavIcon
          href={item.href}
          className={cn(
            "h-6 w-6 transition-colors",
            lit ? "text-brand" : "text-muted-fg",
          )}
        />
        {/* The count rides the icon's corner, where a phone expects a badge. */}
        {item.count != null && item.count > 0 && (
          <span className="absolute -right-2.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[0.625rem] font-bold text-on-brand">
            {item.count > 99 ? "99+" : item.count}
          </span>
        )}
      </span>
      <span
        className={cn(
          "max-w-full truncate text-center text-[0.6875rem] font-medium leading-tight",
          lit ? "text-brand" : "text-muted-fg",
        )}
      >
        {item.label}
      </span>
    </>
  );
}

export function TabBar({
  items,
  className,
}: {
  items: NavItem[];
  className?: string;
}) {
  const current = useCurrentNavItem(items);
  const overflows = items.length > SLOTS;
  const shown = overflows ? items.slice(0, SLOTS - 1) : items;
  const rest = overflows ? items.slice(SLOTS - 1) : [];

  /*
   * The keyboard is taller than the bar, so the bar steps aside for it. iOS
   * overlays the keyboard without shrinking the layout viewport — the visual
   * viewport alone gets shorter, which is what this measures. Android (with
   * `interactive-widget: resizes-content` in the viewport meta) shrinks the
   * whole window instead, so the difference stays ~0 there and the bar simply
   * sits above the keyboard, as Android apps' bars do. 120px separates the
   * keyboard (~300px) from the URL-bar and pinch-zoom noise (<100px).
   */
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const measure = () =>
      // scale === 1 keeps pinch-zoom from masquerading as the keyboard —
      // a zoomed viewport shrinks the same way, and the bar must stay.
      setKeyboardOpen(
        vv.scale === 1 && window.innerHeight - vv.height - vv.offsetTop > 120,
      );
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    return () => {
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
    };
  }, []);

  return (
    <nav
      aria-label="Primary"
      className={cn(
        // Above the page, and padded for the home indicator on a phone — a bar
        // flush to the bottom edge puts its last row of pixels under the
        // gesture area on every iPhone made since 2017.
        //
        // select-none + no callout: a long press on a link in iOS opens a
        // preview sheet, and a tab bar that answers a press-and-hold with a
        // page preview is a web tell. The labels are nav chrome, not text a
        // reader selects.
        // Translucent + blurred like the top bar — iOS tab bars are never a
        // solid slab. `vt-tabbar` names the capture so it holds still while
        // the page behind it pushes or pops.
        // A hairline at half strength: the frost is what separates the bar
        // from the page, and a full-strength rule read as a web footer.
        "vt-tabbar fixed inset-x-0 bottom-0 z-30 select-none border-t border-line/60 bg-surface/80 backdrop-blur-xl backdrop-saturate-150 pb-[env(safe-area-inset-bottom)] [-webkit-touch-callout:none] transition-transform duration-200",
        keyboardOpen && "translate-y-full",
        className
      )}
    >
      <ul className="mx-auto flex max-w-md">
        {shown.map((item) => {
          const active = item === current;
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                // Full prefetch: a handful of links on every page, so a tap renders
                // from cache with no skeleton at all (see NativeGestures for rows).
                prefetch
                aria-current={active ? "page" : undefined}
                /* The iOS reflex: a tap on the lit tab scrolls its page home
                   rather than navigating nowhere. */
                onClick={
                  active
                    ? (e) => {
                        // A re-tap is a scroll, not a navigation — iOS never
                        // reloads the tab you're standing on.
                        e.preventDefault();
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }
                    : undefined
                }
                className="group flex min-h-14 flex-col items-center justify-center gap-1 px-1 pt-1 transition-colors"
              >
                <TabContent item={item} active={active} />
              </Link>
            </li>
          );
        })}

        {rest.length > 0 && (
          <li className="min-w-0 flex-1">
            <Popover
              label="More"
              origin="end"
              width="sm"
              triggerClassName={cn(
                "flex min-h-14 w-full cursor-pointer flex-col items-center justify-center gap-1 px-1 pt-1 transition-colors",
                current && rest.includes(current)
                  ? "text-brand"
                  : "text-muted-fg"
              )}
              trigger={
                <>
                  <MoreHorizontalIcon className="h-6 w-6" />
                  <span className="text-[0.6875rem] font-medium leading-tight">More</span>
                </>
              }
            >
              {rest.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  // Full prefetch: a handful of links on every page, so a tap renders
                  // from cache with no skeleton at all (see NativeGestures for rows).
                  prefetch
                  aria-current={item === current ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-lg px-3 text-[0.9375rem] transition-colors",
                    item === current
                      ? "bg-brand-soft font-semibold text-brand"
                      : "text-ink hover:bg-fill"
                  )}
                >
                  <NavIcon
                    href={item.href}
                    className={cn(
                      "h-5 w-5 shrink-0",
                      item === current ? "text-brand" : "text-muted-fg"
                    )}
                  />
                  {item.label}
                </Link>
              ))}
            </Popover>
          </li>
        )}
      </ul>
    </nav>
  );
}
