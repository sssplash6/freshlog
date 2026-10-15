import { MONTHS } from "@/lib/format";

/**
 * The arithmetic behind scheduled classes: what is reserved, and what a month
 * adds up to for one student.
 *
 * Pure, and in `src/lib` for the reason `calendar.ts` is: the part with edge
 * cases — a class on the 31st, a student with two mentors, a cancelled class
 * that must still show on its month — is the part worth testing without a
 * database.
 *
 * `startsAt` is a PROGRAM wall clock in a UTC field (see `when.ts`), so a
 * class's month is its UTC month, and a 01:00 Tashkent class on the 1st is
 * counted on the 1st, not the night before.
 */

export const CLASS_STATUS = {
  SCHEDULED: "SCHEDULED",
  HELD: "HELD",
  CANCELLED: "CANCELLED",
} as const;

export type ClassStatus = (typeof CLASS_STATUS)[keyof typeof CLASS_STATUS];

/** The longest one class can run. Same ceiling as one logged session. */
export const MAX_CLASS_MINUTES = 8 * 60;

/** How far ahead a class may be put in the diary. A year, not a typo. */
export const MAX_CLASS_DAYS_AHEAD = 366;

export type ClassRow = {
  studentId: string;
  mentorId: string;
  startsAt: Date;
  minutes: number;
  status: string;
};

/** `2026-10` — the key a month is grouped under, and what `?month=` carries. */
export function monthKey(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** `2026-10` → `October 2026`, or null for anything that is not a month. */
export function monthLabel(key: string): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  if (!m) return null;
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** The half-open range `[start, end)` a month key covers, or null. */
export function monthRange(key: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { start: new Date(Date.UTC(y, mo, 1)), end: new Date(Date.UTC(y, mo + 1, 1)) };
}

/** The month before or after, as a key. */
export function shiftMonth(key: string, by: number): string | null {
  const range = monthRange(key);
  if (!range) return null;
  return monthKey(new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth() + by, 1)));
}

/**
 * Minutes still reserved by classes that have not happened: SCHEDULED only.
 * A HELD class's minutes have already been charged by the session that
 * delivered it, so counting them again would spend the same hour twice; a
 * CANCELLED one gave its minutes back.
 */
export function reservedMinutes(rows: readonly Pick<ClassRow, "minutes" | "status">[]): number {
  let total = 0;
  for (const r of rows) if (r.status === CLASS_STATUS.SCHEDULED) total += r.minutes;
  return total;
}

/**
 * Can a class of `minutes` be added without promising more than the student
 * holds with this mentor? `remaining` is the allocation's balance after the
 * sessions already logged; classes still to come are reserved out of it.
 */
export function fitsAllocation(
  remaining: number,
  reserved: number,
  minutes: number
): boolean {
  return minutes <= remaining - reserved;
}

export type MonthTotals = {
  studentId: string;
  /** Classes still to come. */
  scheduled: number;
  /** Classes delivered. */
  held: number;
  /** Cancelled, kept so the month says they existed. Not part of `total`. */
  cancelled: number;
  /** scheduled + held: what the student is booked for this month. */
  total: number;
  classes: number;
};

/**
 * One row per student: the month's classes added up. Only rows inside
 * `[start, end)` are counted, so the caller may pass a wider fetch.
 */
export function monthTotals(
  rows: readonly ClassRow[],
  range: { start: Date; end: Date }
): Map<string, MonthTotals> {
  const out = new Map<string, MonthTotals>();
  for (const r of rows) {
    if (r.startsAt < range.start || r.startsAt >= range.end) continue;
    let t = out.get(r.studentId);
    if (!t) {
      t = { studentId: r.studentId, scheduled: 0, held: 0, cancelled: 0, total: 0, classes: 0 };
      out.set(r.studentId, t);
    }
    if (r.status === CLASS_STATUS.SCHEDULED) {
      t.scheduled += r.minutes;
      t.total += r.minutes;
      t.classes += 1;
    } else if (r.status === CLASS_STATUS.HELD) {
      t.held += r.minutes;
      t.total += r.minutes;
      t.classes += 1;
    } else if (r.status === CLASS_STATUS.CANCELLED) {
      t.cancelled += r.minutes;
    }
  }
  return out;
}
