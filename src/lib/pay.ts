/**
 * What a mentor is owed for the hours they log, worked out with no database.
 *
 * Freshlog owns hours and rates; FreshWeek owns what was billed and paid. This
 * module is the one place the two meet: it turns a mentor's rate rows and
 * sessions into the `PayableSession[]` the payroll contract promises
 * (`payroll-api/contract.ts`), and into the monthly figures the two pay pages
 * show. Everything here is pure, so every rule below is pinned by a unit test.
 *
 * The rules, all of them decisions:
 *
 *   - A RATE is a row that is only ever added. The one in force on day D is
 *     the row with the latest `effectiveFrom` on or before D; two rows on the
 *     same day are a correction, and the newer row (by `createdAt`, then id)
 *     wins. A rate of 0 is a real rate: from that day, nothing is paid.
 *   - A session is PAYABLE when it is ACTIVE and has minutes. A no-show is
 *     paid (the mentor turned up), and so is out-of-plan "extra" time (it was
 *     work). Voided and rescheduled sessions are not.
 *   - Nothing dated before the mentor's FIRST rate is payable: those hours
 *     were not paid by the hour, and a rate set today must not price last
 *     year's diary.
 *
 * MONEY. A session's amount is minutes × centsPerHour / 60 cents, which is
 * usually not a whole cent (25 min at $25/h is 1041.66… cents). So nothing is
 * rounded per session: a total is the exact sum of minutes × centsPerHour
 * ("cent-minutes"), divided by 60 once, and rounded half-up once, when it is
 * shown.
 */

import type { PayableSession, PayRate } from "@/lib/payroll-api/contract";
import { MONTHS, toDateInputValue } from "@/lib/format";
import { programToday } from "@/lib/when";

/** One `MentorPayRate` row, as much of it as the rules read. */
export type RateRow = {
  id: string;
  centsPerHour: number;
  /** UTC midnight of the calendar day it starts, like `Session.date`. */
  effectiveFrom: Date;
  createdAt: Date;
};

/** One `Session`, flattened to what the rules and the contract read. */
export type SessionForPay = {
  id: string;
  /** UTC midnight of the day it was held. */
  date: Date;
  /** When it was first logged. */
  createdAt: Date;
  minutes: number;
  status: string;
  attended: boolean;
  withinPlan: boolean;
  studentAnswer: string | null;
  /** The student's name, or their email when they have none. */
  student: string;
  /** The program's name. */
  program: string;
};

/** Newer first: the later `createdAt`, then the greater id. */
function newer(a: RateRow, b: RateRow): boolean {
  const t = a.createdAt.getTime() - b.createdAt.getTime();
  if (t !== 0) return t > 0;
  return a.id > b.id;
}

/** The rate row in force on `day`, or null when none has started by then. */
export function rateOn(rates: readonly RateRow[], day: Date): RateRow | null {
  const at = day.getTime();
  let best: RateRow | null = null;
  for (const r of rates) {
    const from = r.effectiveFrom.getTime();
    if (from > at) continue;
    if (
      !best ||
      from > best.effectiveFrom.getTime() ||
      (from === best.effectiveFrom.getTime() && newer(r, best))
    ) {
      best = r;
    }
  }
  return best;
}

/**
 * The schedule as it actually applies: one row per start day — the one that
 * won its day — ascending. A row corrected on the same day never priced
 * anything, so it is not part of the schedule.
 */
export function rateSchedule(rates: readonly RateRow[]): RateRow[] {
  const byDay = new Map<number, RateRow>();
  for (const r of rates) {
    const day = r.effectiveFrom.getTime();
    const held = byDay.get(day);
    if (!held || newer(r, held)) byDay.set(day, r);
  }
  return [...byDay.values()].sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime()
  );
}

/** The day pay by the hour started, or null for somebody with no rate. */
export function paidFrom(rates: readonly RateRow[]): Date | null {
  let first: Date | null = null;
  for (const r of rates) {
    if (!first || r.effectiveFrom.getTime() < first.getTime()) first = r.effectiveFrom;
  }
  return first;
}

/** Is this session paid for at all, whatever the rate? */
export function isPayable(s: {
  status: string;
  minutes: number;
}): boolean {
  return s.status === "ACTIVE" && s.minutes > 0;
}

/** The schedule in the contract's words. */
export function contractRates(rates: readonly RateRow[]): PayRate[] {
  return rateSchedule(rates).map((r) => ({
    effectiveFrom: toDateInputValue(r.effectiveFrom),
    centsPerHour: r.centsPerHour,
  }));
}

/**
 * Every payable session, priced at the rate in force on its day, in the
 * contract's shape: ascending by date, then id. Empty for somebody with no
 * rate.
 */
export function payableSessions(
  rates: readonly RateRow[],
  sessions: readonly SessionForPay[]
): PayableSession[] {
  const from = paidFrom(rates);
  if (!from) return [];
  const out: PayableSession[] = [];
  for (const s of sessions) {
    if (!isPayable(s)) continue;
    if (s.date.getTime() < from.getTime()) continue;
    // Never null: the session is on or after the first rate's day.
    const rate = rateOn(rates, s.date)!;
    out.push({
      id: s.id,
      date: toDateInputValue(s.date),
      loggedAt: s.createdAt.toISOString(),
      minutes: s.minutes,
      centsPerHour: rate.centsPerHour,
      student: s.student,
      program: s.program,
      noShow: !s.attended,
      extra: !s.withinPlan,
      disputed: s.studentAnswer === "DISPUTED",
    });
  }
  // YYYY-MM-DD sorts as text in date order.
  const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return out.sort((a, b) => byText(a.date, b.date) || byText(a.id, b.id));
}

/** Exact cent-minutes (minutes × cents per hour) of some payable sessions. */
export function centMinutes(sessions: readonly Pick<PayableSession, "minutes" | "centsPerHour">[]): number {
  let total = 0;
  for (const s of sessions) total += s.minutes * s.centsPerHour;
  return total;
}

/**
 * Cent-minutes to whole cents, rounded half-up — the one rounding a total
 * gets. Exact in integers: cent-minutes stay far below 2^53.
 */
export function roundCents(centMinutes: number): number {
  return Math.floor((centMinutes + 30) / 60);
}

/**
 * Whole cents as dollars: 2000 → "$20", 2050 → "$20.50", 123456 →
 * "$1,234.56". Built from integers, never from a float division, and with the
 * cents dropped only when there are none — `formatMoney`'s convention.
 */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rest = abs % 100;
  return rest === 0
    ? `${sign}$${dollars}`
    : `${sign}$${dollars}.${String(rest).padStart(2, "0")}`;
}

/** A rate as people say it: "$25/h", "$22.50/h". */
export function formatRate(centsPerHour: number): string {
  return `${formatCents(centsPerHour)}/h`;
}

/** "2026-12" for a `YYYY-MM-DD` day. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** "December 2026" for "2026-12". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** The month before or after: shiftMonth("2026-01", -1) is "2025-12". */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + by;
  const year = Math.floor(index / 12);
  return `${year}-${String(index - year * 12 + 1).padStart(2, "0")}`;
}

export type MonthPay = {
  /** "2026-12". */
  month: string;
  sessions: number;
  minutes: number;
  /** Exact; divide by 60 for cents. */
  centMinutes: number;
  /** Rounded half-up once, for display. */
  cents: number;
};

/** One month's payable sessions, totalled. */
export function monthPay(payable: readonly PayableSession[], month: string): MonthPay {
  const inMonth = payable.filter((s) => monthOf(s.date) === month);
  const cm = centMinutes(inMonth);
  return {
    month,
    sessions: inMonth.length,
    minutes: inMonth.reduce((n, s) => n + s.minutes, 0),
    centMinutes: cm,
    cents: roundCents(cm),
  };
}

/**
 * Every month from `first` to `last` inclusive, newest first, empty months
 * included — a month with nothing logged is a month the mentor is owed
 * nothing, which is worth saying rather than skipping. Empty when `first` is
 * after `last`.
 */
export function monthsPay(
  payable: readonly PayableSession[],
  first: string,
  last: string
): MonthPay[] {
  const out: MonthPay[] = [];
  for (let m = last; m >= first; m = shiftMonth(m, -1)) out.push(monthPay(payable, m));
  return out;
}

// ── Setting a rate ───────────────────────────────────────────────────────

/** $1,000 an hour: well past any real rate, and a typo's extra zero. */
export const MAX_CENTS_PER_HOUR = 100_000;

/**
 * "25", "25.5", "25.50" → cents, exactly, with no float in between. At most
 * two decimals; no sign, no exponent, no thousands separator.
 */
export function parseDollarsPerHour(raw: FormDataEntryValue | null): { value: number } | { error: string } {
  const text = String(raw ?? "").trim().replace(/^\$/, "");
  if (!text) return { error: "Enter the rate in US dollars an hour." };
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return { error: "Enter dollars and at most two decimals — 25 or 22.50." };
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (cents > MAX_CENTS_PER_HOUR) return { error: "A rate can be at most $1,000 an hour." };
  return { value: cents };
}

/**
 * The days a new rate may start on, as `YYYY-MM-DD`: from the first of this
 * month in Tashkent to the same day a year from today.
 */
export function rateDayBounds(now: Date = new Date()): { min: string; max: string } {
  const today = programToday(now);
  const [y, m, d] = today.split("-").map(Number);
  // Date.UTC rolls 29 February into 1 March, which is still "about a year".
  const max = toDateInputValue(new Date(Date.UTC(y + 1, m - 1, d)));
  return { min: `${today.slice(0, 7)}-01`, max };
}
