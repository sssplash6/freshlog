import { toDateInputValue } from "@/lib/format";

/**
 * The month arithmetic behind `ui/date-field.tsx`.
 *
 * Here rather than in the component because it is the part with edge cases —
 * a month that opens on a Sunday, February in a leap year, the week that
 * straddles a year — and `src/lib` is where this codebase puts logic it can
 * test without a browser.
 *
 * UTC throughout, in the `YYYY-MM-DD` strings the rest of the app speaks.
 * `new Date(y, m, d)` is local time and would put a mentor west of Greenwich
 * on the previous day; every constructor here is `Date.UTC`.
 */

export const DAY = 86_400_000;

/** `YYYY-MM-DD` → UTC midnight, or null for anything that is not a date. */
export function msOf(iso: string | undefined | null): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  // Date.parse accepts "2026-02-31" in some engines and rolls it forward, so
  // the round trip is what actually rejects a day that does not exist.
  if (Number.isNaN(ms)) return null;
  return toDateInputValue(new Date(ms)) === iso ? ms : null;
}

/** The machine form, through the one function in the app that writes it. */
export function isoOf(ms: number): string {
  return toDateInputValue(new Date(ms));
}

/**
 * Monday-based weekday index, 0–6.
 *
 * Monday first because this is an Uzbek academy and the week starts on Monday
 * here; the native picker this replaces said Sunday because it was reading the
 * browser's locale, which is not the program's.
 */
export function weekday(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % 7;
}

export function startOfMonth(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** Month arithmetic that cannot overflow a day: it always lands on the 1st. */
export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
}

/**
 * The 42 days a month is drawn as: six rows of seven, starting on the Monday
 * on or before the 1st.
 *
 * Always six rows. A month needs four to six depending on its length and which
 * day it opens on, and a grid that grows and shrinks moves the buttons under
 * it — so the "Today" you were aiming at is somewhere else by the time you
 * have paged to the month you wanted.
 */
export function monthGrid(month: number): number[] {
  const first = startOfMonth(month);
  const start = first - weekday(first) * DAY;
  return Array.from({ length: 42 }, (_, i) => start + i * DAY);
}
