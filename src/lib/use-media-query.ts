"use client";

import { useSyncExternalStore } from "react";

/**
 * A media query as a boolean, subscribed the React way.
 *
 * useSyncExternalStore rather than useEffect+useState: a query read in an
 * effect is wrong for the first frame, and the first frame is exactly the one
 * a sheet-vs-popover decision renders.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
