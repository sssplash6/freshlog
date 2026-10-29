import type { ChangelogEntry } from "@/lib/changelog";

/*
 * What's new's figures, moved unchanged from src/app/changelog/page.tsx so the
 * API's What's new counts the week as the page does.
 */

const DAY_MS = 86_400_000;

/** What shipped in the seven days up to now, across every entry. */
export function pastWeek(entries: ChangelogEntry[], now = Date.now()) {
  const since = now - 7 * DAY_MS;
  let added = 0;
  let fixed = 0;
  for (const e of entries) {
    if (new Date(`${e.date}T00:00:00.000Z`).getTime() < since) continue;
    added += e.new.length;
    fixed += e.fixed.length;
  }
  return { new: added, fixed };
}
