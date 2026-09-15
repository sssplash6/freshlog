/**
 * What day it is where the program lives.
 *
 * Freshman Academy runs on Tashkent time. A mentor types "15:00" meaning 15:00
 * Tashkent, and `Interview.scheduledAt` stores exactly that wall clock in a UTC
 * field on purpose (`format.ts:97-109`), so reading it back in UTC hands the
 * student the same 15:00 the mentor meant, whatever the reader's own offset.
 *
 * That convention is deliberate and stays. What was missing is the other half:
 * `now` is a REAL instant from the server clock, so comparing it to a
 * wall-clock-in-a-UTC-field is comparing two different things. Between 00:00
 * and 05:00 Tashkent the two are on different calendar days, and a meeting
 * later that same morning bucketed as tomorrow — or, once the day rolled over
 * in UTC but not in Tashkent, as overdue.
 *
 * So: turn `now` into the same wall clock the stored values are in, and do all
 * day arithmetic there.
 *
 * Uzbekistan is UTC+5 year-round — it dropped daylight saving in 2005 — which
 * is why a fixed offset is correct here and an `Intl` round-trip is not needed.
 */
export const PROGRAM_ZONE = "Tashkent";

const PROGRAM_OFFSET_MINUTES = 5 * 60;
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/**
 * A real instant, re-expressed as the program's wall clock in a UTC field —
 * the same convention `scheduledAt` is stored in, so the two are comparable.
 *
 * Never hand this to a user as a timestamp: it is five hours off the instant it
 * came from, and only its UTC calendar fields mean anything.
 */
export function programWallClock(now: Date): Date {
  return new Date(now.getTime() + PROGRAM_OFFSET_MINUTES * MINUTE);
}

/** Midnight starting the program-local day that `wall` falls in. */
function startOfDay(wall: Date): number {
  return Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
}

/**
 * Whole days from today to `at`, both read as the program's wall clock.
 * Negative is the past, 0 is today, 1 is tomorrow.
 */
export function daysAway(at: Date, now: Date): number {
  return Math.round((startOfDay(at) - startOfDay(programWallClock(now))) / DAY);
}

export type Bucket = "overdue" | "today" | "week" | "later";




/**
 * A meeting's time, labelled with the zone it means.
 *
 * The label is not decoration: a mentor in Tashkent and a student who moved to
 * Seoul read the same "15:00" off this page, and only one of them is right
 * about what it means locally. Naming the zone is what makes the stored
 * wall-clock convention honest instead of merely convenient.
 */
export function formatTimeOfDay(at: Date, hasTime: boolean): string | null {
  if (!hasTime) return null;
  const hh = String(at.getUTCHours()).padStart(2, "0");
  const mm = String(at.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} ${PROGRAM_ZONE}`;
}
