import { describe, expect, it } from "vitest";

import { chargeableAgainst, deadlinePassed, soonestExpiry } from "@/lib/deadlines";

const NOW = new Date("2026-09-08T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY);

describe("soonestExpiry", () => {
  it("returns the soonest date and only the minutes behind it", () => {
    // Charos Hakimova's real ledger, which is what found this: 2h ending on
    // the 20th and 43h 30m ending in 2027. Her page said "45h 30m expires
    // September 20" — the soonest date and the whole balance, in one sentence.
    expect(
      soonestExpiry(
        [
          { remaining: 120, deadline: inDays(12) },
          { remaining: 2190, deadline: inDays(494) },
          { remaining: 420, deadline: inDays(494) },
        ],
        NOW
      )
    ).toEqual({ minutes: 120, date: inDays(12) });
  });

  it("sums every grant that falls on the soonest date", () => {
    // Two mentors both ending 15 January is ONE deadline with both balances
    // behind it, and a warning naming half of it understates the loss.
    expect(
      soonestExpiry(
        [
          { remaining: 2190, deadline: inDays(30) },
          { remaining: 420, deadline: inDays(30) },
          { remaining: 60, deadline: inDays(90) },
        ],
        NOW
      )
    ).toEqual({ minutes: 2610, date: inDays(30) });
  });

  it("ignores a deadline that has already passed", () => {
    // Those minutes are forfeited, which ALLOCATION_EXPIRED says instead.
    expect(
      soonestExpiry(
        [
          { remaining: 300, deadline: inDays(-2) },
          { remaining: 120, deadline: inDays(9) },
        ],
        NOW
      )
    ).toEqual({ minutes: 120, date: inDays(9) });
  });

  it("ignores a grant with nothing left in it, and one already expired", () => {
    expect(
      soonestExpiry(
        [
          { remaining: 0, deadline: inDays(3) },
          { remaining: -60, deadline: inDays(4) },
          { remaining: 90, deadline: inDays(5), expired: true },
          { remaining: 120, deadline: inDays(20) },
        ],
        NOW
      )
    ).toEqual({ minutes: 120, date: inDays(20) });
  });

  it("is null when nothing can expire", () => {
    expect(soonestExpiry([], NOW)).toBeNull();
    expect(soonestExpiry([{ remaining: 120, deadline: null }], NOW)).toBeNull();
    expect(
      soonestExpiry([{ remaining: 0, deadline: inDays(3) }], NOW)
    ).toBeNull();
    // Every grant in the past: forfeited, not expiring.
    expect(
      soonestExpiry([{ remaining: 300, deadline: inDays(-1) }], NOW)
    ).toBeNull();
  });

  it("counts a deadline landing today as still ahead", () => {
    // "Unused time is forfeited on the day it expires" — so on the day it is
    // the most urgent warning there is, not an expired one.
    const today = soonestExpiry([{ remaining: 120, deadline: NOW }], NOW);
    expect(today).toEqual({ minutes: 120, date: NOW });
  });
});

describe("deadlinePassed", () => {
  // "Use by 13 September", stored as the program day at UTC midnight.
  const deadline = new Date("2026-09-13T00:00:00.000Z");

  it("holds the whole deadline day, Tashkent time", () => {
    // 23:30 Tashkent on the 13th. The old check had closed it at 05:00.
    expect(deadlinePassed(deadline, Date.parse("2026-09-13T18:30:00Z"))).toBe(false);
  });

  it("closes at Tashkent midnight after it", () => {
    expect(deadlinePassed(deadline, Date.parse("2026-09-13T19:00:00Z"))).toBe(true);
  });
});

describe("chargeableAgainst", () => {
  const deadline = new Date("2026-09-13T00:00:00.000Z");
  const held = new Date("2026-09-13T00:00:00.000Z");

  it("takes a session held by the deadline and logged days later", () => {
    expect(chargeableAgainst(deadline, held, Date.parse("2026-09-15T04:00:00Z"))).toEqual({
      ok: true,
    });
  });

  it("refuses a session held after the deadline", () => {
    expect(
      chargeableAgainst(deadline, new Date("2026-09-14T00:00:00.000Z"), Date.parse("2026-09-14T04:00:00Z"))
    ).toEqual({ ok: false, reason: "after-deadline" });
  });

  it("closes two weeks after the deadline day ends", () => {
    // Last day to log is the 27th; Tashkent midnight after it is 19:00Z.
    expect(chargeableAgainst(deadline, held, Date.parse("2026-09-27T18:59:00Z")).ok).toBe(true);
    expect(chargeableAgainst(deadline, held, Date.parse("2026-09-27T19:00:00Z"))).toEqual({
      ok: false,
      reason: "too-late",
    });
  });
});
