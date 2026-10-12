"use client";

import { useEffect, useState } from "react";

import { StatusChip } from "@/components/ui/status-chip";
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

/**
 * The "New" marker, decided on the FIRST render and kept.
 *
 * Marking the page seen revalidates the layout, which re-renders this page with
 * `fresh` now false for every entry. A chip that followed the prop would vanish
 * a moment after the reader arrived — before they could tell which entries were
 * the new ones. State survives that refresh; the prop does not.
 */
export function FreshChip({ fresh }: { fresh: boolean }) {
  const [wasFresh] = useState(fresh);
  return wasFresh ? <StatusChip severity="neutral">New</StatusChip> : null;
}
