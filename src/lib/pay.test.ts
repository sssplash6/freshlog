import { describe, expect, it } from "vitest";

import {
  centMinutes,
  contractRates,
  formatCents,
  formatRate,
  isPayable,
  monthLabel,
  monthPay,
  monthsPay,
  paidFrom,
  payableSessions,
  rateOn,
  rateSchedule,
  roundCents,
  shiftMonth,
  type RateRow,
  type SessionForPay,
} from "@/lib/pay";

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

let n = 0;
function rate(effectiveFrom: string, centsPerHour: number, createdAt = "2026-11-01T10:00:00.000Z", id?: string): RateRow {
  return { id: id ?? `r${++n}`, centsPerHour, effectiveFrom: day(effectiveFrom), createdAt: new Date(createdAt) };
}

function sess(over: Partial<Omit<SessionForPay, "date">> & { id: string; date: string }): SessionForPay {
  const { date, ...rest } = over;
  return {
    createdAt: new Date(`${date}T12:00:00.000Z`),
    minutes: 60,
    status: "ACTIVE",
    attended: true,
    withinPlan: true,
    studentAnswer: null,
    student: "Student One",
    program: "SAT",
    ...rest,
    date: day(date),
  };
}

describe("rateOn", () => {
  it("is null before the first rate, and the first rate on its own day", () => {
    const rates = [rate("2026-12-01", 2000)];
    expect(rateOn(rates, day("2026-11-30"))).toBeNull();
    expect(rateOn(rates, day("2026-12-01"))?.centsPerHour).toBe(2000);
    expect(rateOn(rates, day("2027-06-01"))?.centsPerHour).toBe(2000);
  });

  it("switches on the new rate's day exactly, not a day early or late", () => {
    const rates = [rate("2026-12-15", 2500), rate("2026-12-01", 2000)];
    expect(rateOn(rates, day("2026-12-14"))?.centsPerHour).toBe(2000);
    expect(rateOn(rates, day("2026-12-15"))?.centsPerHour).toBe(2500);
    expect(rateOn(rates, day("2026-12-16"))?.centsPerHour).toBe(2500);
  });

  it("does not care what order the rows come in", () => {
    const a = rate("2026-12-01", 2000);
    const b = rate("2027-01-01", 3000);
    expect(rateOn([a, b], day("2027-01-05"))?.id).toBe(b.id);
    expect(rateOn([b, a], day("2027-01-05"))?.id).toBe(b.id);
  });

  it("on a tie of days, the newer row wins (a correction), whichever order", () => {
    const typo = rate("2026-12-01", 200000, "2026-11-20T09:00:00.000Z");
    const fixed = rate("2026-12-01", 2000, "2026-11-20T09:05:00.000Z");
    expect(rateOn([typo, fixed], day("2026-12-03"))?.centsPerHour).toBe(2000);
    expect(rateOn([fixed, typo], day("2026-12-03"))?.centsPerHour).toBe(2000);
  });

  it("on a tie of days and instants, the greater id wins", () => {
    const at = "2026-11-20T09:00:00.000Z";
    const a = rate("2026-12-01", 1000, at, "aaa");
    const b = rate("2026-12-01", 2000, at, "bbb");
    expect(rateOn([a, b], day("2026-12-01"))?.id).toBe("bbb");
    expect(rateOn([b, a], day("2026-12-01"))?.id).toBe("bbb");
  });

  it("a newer row for an EARLIER day does not beat an older row for a later day", () => {
    const later = rate("2026-12-15", 2500, "2026-11-01T00:00:00.000Z");
    const earlierAddedLater = rate("2026-12-10", 9999, "2026-12-20T00:00:00.000Z");
    expect(rateOn([later, earlierAddedLater], day("2026-12-16"))?.centsPerHour).toBe(2500);
    expect(rateOn([later, earlierAddedLater], day("2026-12-12"))?.centsPerHour).toBe(9999);
  });

  it("returns a zero rate as a rate, not as nothing", () => {
    const rates = [rate("2026-12-01", 2000), rate("2027-01-01", 0)];
    expect(rateOn(rates, day("2027-01-02"))?.centsPerHour).toBe(0);
  });
});

describe("rateSchedule and contractRates", () => {
  it("is one row per start day, the winner, ascending", () => {
    const rates = [
      rate("2026-12-15", 2500),
      rate("2026-12-01", 900, "2026-11-01T00:00:00.000Z"),
      rate("2026-12-01", 2000, "2026-11-02T00:00:00.000Z"),
    ];
    expect(rateSchedule(rates).map((r) => r.centsPerHour)).toEqual([2000, 2500]);
    expect(contractRates(rates)).toEqual([
      { effectiveFrom: "2026-12-01", centsPerHour: 2000 },
      { effectiveFrom: "2026-12-15", centsPerHour: 2500 },
    ]);
  });

  it("is empty with no rates", () => {
    expect(contractRates([])).toEqual([]);
    expect(paidFrom([])).toBeNull();
  });

  it("paidFrom is the earliest start day, whatever the order", () => {
    expect(paidFrom([rate("2027-01-01", 1), rate("2026-12-01", 2)])).toEqual(day("2026-12-01"));
  });
});

describe("isPayable", () => {
  it("pays ACTIVE sessions with minutes and nothing else", () => {
    expect(isPayable({ status: "ACTIVE", minutes: 60 })).toBe(true);
    expect(isPayable({ status: "VOIDED", minutes: 60 })).toBe(false);
    expect(isPayable({ status: "RESCHEDULED", minutes: 60 })).toBe(false);
    expect(isPayable({ status: "ACTIVE", minutes: 0 })).toBe(false);
  });
});

describe("payableSessions", () => {
  const rates = [rate("2026-12-01", 2000), rate("2026-12-15", 2500)];

  it("is empty for somebody with no rate, however much they logged", () => {
    expect(payableSessions([], [sess({ id: "a", date: "2026-12-02" })])).toEqual([]);
  });

  it("leaves out sessions dated before the first rate, keeps the first rate's own day", () => {
    const out = payableSessions(rates, [
      sess({ id: "before", date: "2026-11-30" }),
      sess({ id: "on", date: "2026-12-01" }),
    ]);
    expect(out.map((s) => s.id)).toEqual(["on"]);
  });

  it("leaves out voided, rescheduled and empty sessions", () => {
    const out = payableSessions(rates, [
      sess({ id: "v", date: "2026-12-02", status: "VOIDED" }),
      sess({ id: "r", date: "2026-12-02", status: "RESCHEDULED" }),
      sess({ id: "z", date: "2026-12-02", minutes: 0 }),
      sess({ id: "ok", date: "2026-12-02" }),
    ]);
    expect(out.map((s) => s.id)).toEqual(["ok"]);
  });

  it("pays no-shows and out-of-plan time, and says which they were", () => {
    const out = payableSessions(rates, [
      sess({ id: "noshow", date: "2026-12-02", attended: false }),
      sess({ id: "extra", date: "2026-12-03", withinPlan: false }),
      sess({ id: "disputed", date: "2026-12-04", studentAnswer: "DISPUTED" }),
      sess({ id: "confirmed", date: "2026-12-05", studentAnswer: "CONFIRMED" }),
    ]);
    expect(out.map((s) => [s.id, s.noShow, s.extra, s.disputed])).toEqual([
      ["noshow", true, false, false],
      ["extra", false, true, false],
      ["disputed", false, false, true],
      ["confirmed", false, false, false],
    ]);
  });

  it("prices each session at the rate in force on its own day, across a mid-month change", () => {
    const out = payableSessions(rates, [
      sess({ id: "a", date: "2026-12-14" }),
      sess({ id: "b", date: "2026-12-15" }),
    ]);
    expect(out.map((s) => s.centsPerHour)).toEqual([2000, 2500]);
  });

  it("keeps sessions under a zero rate, priced at zero", () => {
    const out = payableSessions([rate("2026-12-01", 2000), rate("2027-01-01", 0)], [
      sess({ id: "a", date: "2027-01-03", minutes: 30 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].centsPerHour).toBe(0);
  });

  it("sorts by date, then id, and writes the contract's fields", () => {
    const out = payableSessions(rates, [
      sess({ id: "s-b", date: "2026-12-10", createdAt: new Date("2026-12-11T09:00:00.000Z"), minutes: 45 }),
      sess({ id: "s-a", date: "2026-12-10" }),
      sess({ id: "s-0", date: "2026-12-02", student: "Two", program: "GA" }),
    ]);
    expect(out.map((s) => s.id)).toEqual(["s-0", "s-a", "s-b"]);
    expect(out[2]).toEqual({
      id: "s-b",
      date: "2026-12-10",
      loggedAt: "2026-12-11T09:00:00.000Z",
      minutes: 45,
      centsPerHour: 2000,
      student: "Student One",
      program: "SAT",
      noShow: false,
      extra: false,
      disputed: false,
    });
    expect(out[0].student).toBe("Two");
    expect(out[0].program).toBe("GA");
  });
});

describe("money", () => {
  it("rounds cent-minutes half-up, once", () => {
    expect(roundCents(0)).toBe(0);
    expect(roundCents(29)).toBe(0); // 0.48 c
    expect(roundCents(30)).toBe(1); // exactly half a cent → up
    expect(roundCents(89)).toBe(1); // 1.48 c
    expect(roundCents(90)).toBe(2); // 1.5 c → up
    expect(roundCents(120000)).toBe(2000);
  });

  it("sums exactly before it rounds: three 1/3-cent sessions are one cent, not zero", () => {
    // 1 minute at 20 c/h is 1/3 of a cent. Rounded one by one, three are 0.
    const s = [1, 2, 3].map(() => ({ minutes: 1, centsPerHour: 20 }));
    expect(centMinutes(s)).toBe(60);
    expect(roundCents(centMinutes(s))).toBe(1);
  });

  it("totals a month across a rate change, the sample's December", () => {
    // 60m@$20 + 45m@$20 + 90m@$25 + 25m@$25 = 2000 + 1500 + 3750 + 1041.67 = 8291.67 c
    const payable = payableSessions([rate("2026-12-01", 2000), rate("2026-12-15", 2500)], [
      sess({ id: "a", date: "2026-12-02", minutes: 60 }),
      sess({ id: "b", date: "2026-12-10", minutes: 45, attended: false }),
      sess({ id: "c", date: "2026-12-16", minutes: 90, withinPlan: false }),
      sess({ id: "d", date: "2026-12-20", minutes: 25 }),
      sess({ id: "jan", date: "2027-01-02", minutes: 60 }),
    ]);
    const dec = monthPay(payable, "2026-12");
    expect(dec).toEqual({
      month: "2026-12",
      sessions: 4,
      minutes: 220,
      centMinutes: 60 * 2000 + 45 * 2000 + 90 * 2500 + 25 * 2500,
      cents: 8292,
    });
    expect(formatCents(dec.cents)).toBe("$82.92");
  });

  it("rounds a total that lands on exactly half a cent up", () => {
    // 1 minute at 30 c/h = 0.5 c.
    const payable = payableSessions([rate("2026-12-01", 30)], [sess({ id: "a", date: "2026-12-02", minutes: 1 })]);
    expect(monthPay(payable, "2026-12").cents).toBe(1);
  });

  it("formats whole cents without a float", () => {
    expect(formatCents(0)).toBe("$0");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(2000)).toBe("$20");
    expect(formatCents(2050)).toBe("$20.50");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
    expect(formatRate(2250)).toBe("$22.50/h");
  });
});

describe("months", () => {
  it("shifts across a year", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-06", -18)).toBe("2024-12");
  });

  it("names a month", () => {
    expect(monthLabel("2026-12")).toBe("December 2026");
  });

  it("lists every month in range, newest first, empty ones included", () => {
    const payable = payableSessions([rate("2026-11-01", 6000)], [sess({ id: "a", date: "2026-11-20", minutes: 30 })]);
    const months = monthsPay(payable, "2026-11", "2027-01");
    expect(months.map((m) => [m.month, m.sessions, m.minutes, m.cents])).toEqual([
      ["2027-01", 0, 0, 0],
      ["2026-12", 0, 0, 0],
      ["2026-11", 1, 30, 3000],
    ]);
  });

  it("is empty when pay starts after the last month asked for", () => {
    expect(monthsPay([], "2027-02", "2026-12")).toEqual([]);
  });
});
