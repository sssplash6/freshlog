"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Say which page just opened, and put the reader on it.
 *
 * A full page load announces itself: the browser reads the new title and
 * starts at the top. A client-side navigation does neither. Pressing "Mentors"
 * in the sidebar removed the link that had focus, so focus fell to `<body>`,
 * and a screen reader said nothing at all; a keyboard user had to Tab back
 * through the whole sidebar to reach the page they had just asked for
 * (October 2026 audit).
 *
 * So after the pathname changes — and not for a filter, which changes only the
 * query — the page's title is written into a polite live region and focus
 * moves to `<main>`, which is focusable (`tabIndex={-1}`) for exactly this and
 * for the skip link. Focus is only moved when it has nowhere better to be:
 * if the new page put the caret in a field, that stays.
 *
 * The first render is skipped: that is a full load, and the browser did it.
 */
export function RouteAnnouncer() {
  const pathname = usePathname();
  const first = useRef(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // Next writes the new `<title>` a moment after the route commits.
    const timer = window.setTimeout(() => {
      setMessage(document.title);
      const active = document.activeElement;
      if (!active || active === document.body) {
        document.getElementById("main")?.focus({ preventScroll: true });
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}
