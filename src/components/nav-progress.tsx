"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { setPendingHref } from "@/lib/nav-pending";

/** Give up on a navigation that never lands (offline, an error page). */
const GIVE_UP_MS = 12_000;

/**
 * Say "going" the instant a link is tapped, and "there" the instant it lands.
 *
 * Two jobs, both about the gap between a tap and the server's answer:
 *
 *   1. It records the destination (`setPendingHref`), so the nav highlight
 *      moves on touch instead of after the round trip.
 *   2. It draws a 2px brand line across the top of the window that creeps
 *      toward the right while the page is on its way. It is invisible for the
 *      first 120ms (the CSS delay on `nav-progress`), so a navigation the
 *      prefetch has already paid for shows nothing at all — the bar exists for
 *      the slow ones, where silence reads as a frozen app.
 *
 * Detection is a capture-phase click listener on the document rather than a
 * wrapper around every `<Link>`: this app has links in chips, rows, menus and
 * the command palette, and a progress bar that only some of them started would
 * be a bar nobody could trust. It ignores anything the router will not handle —
 * new tabs, modified clicks, downloads, other origins, and a link to the page
 * you are already on. `router.push` callers can announce themselves with the
 * `nav-start` event.
 *
 * Landing is the pathname or search changing, which is exactly when the router
 * commits the new page.
 *
 * The bar's state lives on the element (`data-state`), not in React: it is a
 * purely visual signal driven by DOM events, and routing it through state would
 * re-render on every tap for an attribute CSS already knows how to read.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const bar = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const set = (state: "idle" | "going" | "done") => {
      if (bar.current) bar.current.dataset.state = state;
    };
    function start(href: string) {
      setPendingHref(href);
      set("going");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setPendingHref(null);
        set("idle");
      }, GIVE_UP_MS);
    }

    function onClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor || !anchor.href) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Route handlers are real page loads, not client navigations.
      if (url.pathname.startsWith("/api/")) return;
      const here = window.location.pathname + window.location.search;
      if (url.pathname + url.search === here) return;
      start(url.pathname);
    }

    function onNavStart(event: Event) {
      const href = (event as CustomEvent<string>).detail;
      if (typeof href === "string") start(new URL(href, window.location.href).pathname);
    }

    document.addEventListener("click", onClick, true);
    window.addEventListener("nav-start", onNavStart);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("nav-start", onNavStart);
    };
  }, []);

  // Landed: finish the bar, then let it fade. Deliberately keyed on the URL
  // alone — whatever started the navigation, this is the moment it is over.
  useEffect(() => {
    setPendingHref(null);
    if (timer.current) clearTimeout(timer.current);
    const el = bar.current;
    if (!el || el.dataset.state !== "going") return;
    el.dataset.state = "done";
    const t = setTimeout(() => {
      if (el.dataset.state === "done") el.dataset.state = "idle";
    }, 300);
    return () => clearTimeout(t);
  }, [pathname, search]);

  return (
    <div
      ref={bar}
      aria-hidden="true"
      data-state="idle"
      className="nav-progress pointer-events-none fixed inset-x-0 top-0 z-[70] h-0.5 origin-left bg-brand"
    />
  );
}
