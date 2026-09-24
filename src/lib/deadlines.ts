import { programDayEnds } from "@/lib/when";

/**
 * Client-safe deadline helpers. Kept out of component bodies so the
 * react-hooks purity lint doesn't flag the `Date.now()` call, and so the
 * "has it expired?" rule lives in exactly one place.
 *
 * A deadline is a program DAY, and the whole of it is usable: hours to use by
 * 13 September are still good at 23:30 Tashkent on the 13th. Once that day is
 * over, the unused hours are forfeited.
 */
export function deadlinePassed(deadline: Date, now: number = Date.now()): boolean {
  return now >= programDayEnds(deadline);
}

/**
 * How long after a deadline a session HELD before it may still be logged.
 *
 * A mentor who met a student late on the 13th, slept, and came back on the
 * 15th was told the hours had expired — the check asked when the log was
 * typed, not when the meeting happened. The meeting is what spends the hours,
 * so its date is what is held against the deadline. The window is what stops
 * that from reopening forfeited hours months later.
 */
export const LATE_LOG_GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant late logging against this deadline closes. */
export function lateLogCloses(deadline: Date): number {
  return programDayEnds(deadline) + LATE_LOG_GRACE_DAYS * DAY_MS;
}

/** The last program day a late log is accepted on, for saying it out loud. */
export function lateLogLastDay(deadline: Date): Date {
  return new Date(deadline.getTime() + LATE_LOG_GRACE_DAYS * DAY_MS);
}

/**
 * Whether a session held on `date` may be charged to hours that expire on
 * `deadline`, logged at `now`. Both days are program days stored at UTC
 * midnight, so they compare directly.
 */
export function chargeableAgainst(
  deadline: Date,
  date: Date,
  now: number = Date.now()
): { ok: true } | { ok: false; reason: "after-deadline" | "too-late" } {
  if (date.getTime() > deadline.getTime()) return { ok: false, reason: "after-deadline" };
  if (now >= lateLogCloses(deadline)) return { ok: false, reason: "too-late" };
  return { ok: true };
}

/**
 * The soonest use-by date still ahead, and ONLY the minutes that expire on it.
 *
 * The pair is returned as one object because the bug it fixes was two fields
 * that disagreed. A student's page said "45h 30m expires September 20" when
 * September 20 was one grant's deadline holding 2h, and 45h 30m was the
 * student's whole balance across four grants — three of which ran to 2027.
 * `studentStatuses` had been handed the soonest DATE and the total REMAINING
 * and put them in one sentence, which is `AGENTS.md`'s rule about never
 * keying a total on the wrong thing, in its loudest form: the row named a
 * number twenty times too big and asked somebody to act on it.
 *
 * Several grants can share a date, so the minutes are summed across every
 * grant that falls on the soonest one — two mentors both ending 15 January is
 * one deadline with both balances behind it.
 *
 * A grant that has already passed is not a candidate: those minutes are
 * forfeited, which `ALLOCATION_EXPIRED` says instead. Nor is one with nothing
 * left in it — an empty grant reaching its date loses nothing.
 */
export function soonestExpiry(
  grants: readonly {
    remaining: number;
    deadline: Date | null;
    expired?: boolean;
  }[],
  now: Date
): { minutes: number; date: Date } | null {
  const at = now.getTime();
  const live = grants.filter(
    (g) =>
      g.deadline != null &&
      !g.expired &&
      g.remaining > 0 &&
      !deadlinePassed(g.deadline, at)
  );
  if (live.length === 0) return null;

  const date = live.reduce<Date>(
    (soonest, g) => ((g.deadline as Date) < soonest ? (g.deadline as Date) : soonest),
    live[0].deadline as Date
  );
  const day = date.getTime();
  const minutes = live.reduce(
    (sum, g) => sum + ((g.deadline as Date).getTime() === day ? g.remaining : 0),
    0
  );
  return { minutes, date };
}
