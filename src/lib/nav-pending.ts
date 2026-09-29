"use client";

import { useSyncExternalStore } from "react";

/**
 * Where the reader just asked to go, before the router has got there.
 *
 * A tap on a nav item used to change nothing on screen until the server
 * answered: the old item stayed lit and the page stayed put, so for the length
 * of a round trip the app looked as if it had not heard. Native apps move the
 * selection on touch. This is that: `NavProgress` records the destination the
 * instant an internal link is clicked, `useCurrentNavItem` prefers it over the
 * pathname, and it clears itself when the pathname actually changes.
 *
 * A module-level store rather than context, because the writer (a document
 * click listener) and the readers (sidebar, tab bar, top nav) live in
 * different client trees under server layouts.
 */
let pending: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setPendingHref(href: string | null) {
  if (pending === href) return;
  pending = href;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The path (no query) the reader is on the way to, or null. */
export function usePendingHref(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => pending,
    () => null
  );
}
