/**
 * Client-safe deadline helper. Kept out of component bodies so the
 * react-hooks purity lint doesn't flag the `Date.now()` call, and so the
 * "has it expired?" rule lives in exactly one place.
 *
 * Once an allocation's use-by deadline has passed, its unused hours are
 * forfeited and no new sessions may be logged against it.
 */
export function deadlinePassed(deadline: Date): boolean {
  return deadline.getTime() < Date.now();
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
      g.deadline.getTime() >= at
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
