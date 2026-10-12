"use client";

import { useEffect } from "react";

import { markChangelogSeen } from "@/lib/actions/changelog";

/**
 * Records the visit once the page is on screen. In an effect, not in the page
 * function, so a prefetch of the link never clears the dot and the database is
 * not written during render.
 */
export function MarkChangelogSeen() {
  useEffect(() => {
    void markChangelogSeen();
  }, []);
  return null;
}
