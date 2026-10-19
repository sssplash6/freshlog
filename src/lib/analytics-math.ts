/**
 * The arithmetic behind the analytics dashboard, over the compact rows
 * `lib/analytics.ts` produces. Client-safe and pure, so every figure the
 * dashboard draws can be tested without a database.
 *
 * Every total is whole MINUTES. "Hours" on the dashboard means COMPLETED plus
 * EXTRA plus MISSED — every minute a mentor set aside for a student — and the
 * three are always shown apart as well, so the ledger's own "Completed" is
 * never inflated by out-of-plan work or by a meeting nobody came to.
 *
 * MISSED COUNTS (13 October 2026). A no-show is charged to the student's
 * hours, and the mentor kept the slot: it was asked that it count for the
 * mentor and the program too, but stay visible as its own part. Until then it
 * was counted and never summed, so a mentor whose students missed meetings
 * read short of the hours the ledger had already spent on them.
 */

import type { AnalyticsRow } from "@/lib/analytics";
import { DAY } from "@/lib/calendar";
import { formatDuration } from "@/lib/format";

const KIND_COMPLETED = 0;
const KIND_EXTRA = 1;
const KIND_NO_SHOW = 2;

export type Filter = {
  /** Left out for a window of chosen days, which may cross a new year. */
  year?: number;
  /** 0–11, or null for the whole year. */
  month?: number | null;
  /** First and last day of a chosen window, inclusive, as yyyymmdd. */
  from?: number | null;
  to?: number | null;
  program?: number | null;
  mentor?: number | null;
};

export type Tally = {
  completed: number;
  extra: number;
  noShow: number;
  /** Attended sessions — no-shows are counted in `noShows`. */
  sessions: number;
  /** Sessions the student did not come to; their minutes are `noShow`. */
  noShows: number;
};

export type Totals = Tally & {
  hours: number;
  students: number;
  mentors: number;
};

export const yearOf = (day: number) => Math.floor(day / 10000);
export const monthOf = (day: number) => Math.floor(day / 100) % 100 - 1;
export const dateOf = (day: number) => day % 100;

/** A UTC midnight as its day key, yyyymmdd. */
export function dayKeyOf(ms: number): number {
  const d = new Date(ms);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

export const msOfDay = (day: number) => Date.UTC(yearOf(day), monthOf(day), dateOf(day));

/** The window as long as `from`..`to` that ends the day before it: what it is compared with. */
export function windowBefore(from: number, to: number): [number, number] {
  const start = msOfDay(from);
  const days = Math.round((msOfDay(to) - start) / DAY) + 1;
  return [dayKeyOf(start - days * DAY), dayKeyOf(start - DAY)];
}

export function emptyTally(): Tally {
  return { completed: 0, extra: 0, noShow: 0, sessions: 0, noShows: 0 };
}

function add(t: Tally, row: AnalyticsRow): void {
  const minutes = row[4];
  if (row[5] === KIND_NO_SHOW) {
    t.noShow += minutes;
    t.noShows += 1;
    return;
  }
  if (row[5] === KIND_EXTRA) t.extra += minutes;
  else if (row[5] === KIND_COMPLETED) t.completed += minutes;
  t.sessions += 1;
}

/** Minutes a mentor set aside for students: in plan, extra, and missed. */
export function hoursOf(t: Tally): number {
  return t.completed + t.extra + t.noShow;
}

/** Every session in the tally, attended or missed. */
export function meetingsOf(t: Tally): number {
  return t.sessions + t.noShows;
}

export function matches(row: AnalyticsRow, f: Filter): boolean {
  if (f.year != null && yearOf(row[3]) !== f.year) return false;
  if (f.from != null && row[3] < f.from) return false;
  if (f.to != null && row[3] > f.to) return false;
  if (f.month != null && monthOf(row[3]) !== f.month) return false;
  if (f.program != null && row[0] !== f.program) return false;
  if (f.mentor != null && row[1] !== f.mentor) return false;
  return true;
}

export function select(rows: readonly AnalyticsRow[], f: Filter): AnalyticsRow[] {
  return rows.filter((r) => matches(r, f));
}

/** Every year that holds a session, plus the current one, newest first. */
export function yearsOf(rows: readonly AnalyticsRow[], current: number): number[] {
  const years = new Set<number>([current]);
  for (const r of rows) years.add(yearOf(r[3]));
  return [...years].sort((a, b) => b - a);
}

export function totals(rows: readonly AnalyticsRow[]): Totals {
  const t = emptyTally();
  const students = new Set<number>();
  const mentors = new Set<number>();
  for (const r of rows) {
    add(t, r);
    students.add(r[2]);
    mentors.add(r[1]);
  }
  return { ...t, hours: hoursOf(t), students: students.size, mentors: mentors.size };
}

/** Twelve tallies, January first. */
export function byMonth(rows: readonly AnalyticsRow[]): Tally[] {
  const months = Array.from({ length: 12 }, emptyTally);
  for (const r of rows) add(months[monthOf(r[3])], r);
  return months;
}

export function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** One tally per calendar day of the month, the 1st first. */
export function byDay(rows: readonly AnalyticsRow[], year: number, month: number): Tally[] {
  const days = Array.from({ length: daysIn(year, month) }, emptyTally);
  for (const r of rows) {
    if (yearOf(r[3]) === year && monthOf(r[3]) === month) add(days[dateOf(r[3]) - 1], r);
  }
  return days;
}

/**
 * Minutes each program's grant has ever paid for, ignoring the year:
 * `[program]`. That is what the ledger draws — in-plan meetings, attended or
 * missed — and not extra time, which charges nobody: read against the grant,
 * extra time pushed a program past 100% of hours it had not spent.
 */
export function drawnByProgram(
  rows: readonly AnalyticsRow[],
  programCount: number
): number[] {
  const out = new Array<number>(programCount).fill(0);
  for (const r of rows) if (r[5] !== KIND_EXTRA) out[r[0]] += r[4];
  return out;
}

/** Hours per program index, per month: `[program][month]`. */
export function monthsByProgram(
  rows: readonly AnalyticsRow[],
  programCount: number
): number[][] {
  const grid = Array.from({ length: programCount }, () => new Array<number>(12).fill(0));
  for (const r of rows) grid[r[0]][monthOf(r[3])] += r[4];
  return grid;
}

export type Ranked = Totals & {
  index: number;
  /** Hours per month of the year, for a sparkline. */
  trend: number[];
};

/**
 * Totals per `key` (0 = program, 1 = mentor), largest first. `trendRows` is
 * the whole year even when `rows` is one month, so a sparkline keeps its shape
 * while the figure beside it narrows.
 */
export function rankBy(
  rows: readonly AnalyticsRow[],
  trendRows: readonly AnalyticsRow[],
  key: 0 | 1
): Ranked[] {
  const groups = new Map<number, AnalyticsRow[]>();
  for (const r of rows) {
    const list = groups.get(r[key]);
    if (list) list.push(r);
    else groups.set(r[key], [r]);
  }
  const trends = new Map<number, number[]>();
  for (const r of trendRows) {
    let t = trends.get(r[key]);
    if (!t) trends.set(r[key], (t = new Array<number>(12).fill(0)));
    t[monthOf(r[3])] += r[4];
  }
  return [...groups.entries()]
    .map(([index, list]) => ({
      index,
      ...totals(list),
      trend: trends.get(index) ?? new Array<number>(12).fill(0),
    }))
    .sort((a, b) => b.hours - a.hours || meetingsOf(b) - meetingsOf(a));
}

/**
 * Relative change, or null when there is no base to compare against — "up
 * from zero" is not a percentage, and printing +∞% would be a lie with a sign.
 */
export function change(now: number, before: number): number | null {
  if (before <= 0) return null;
  return (now - before) / before;
}

/** Monday-first weeks of a year, each seven day keys or null outside the year. */
export function weeksOf(year: number): (number | null)[][] {
  const first = new Date(Date.UTC(year, 0, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = new Array(lead).fill(null);
  for (let d = new Date(first); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
    week.push(d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate());
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) weeks.push([...week, ...new Array(7 - week.length).fill(null)]);
  return weeks;
}

/** Hours per day key. */
export function hoursByDay(rows: readonly AnalyticsRow[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of rows) out.set(r[3], (out.get(r[3]) ?? 0) + r[4]);
  return out;
}

/**
 * A roll-up in hours, short: 45 → "45 min", 90 → "1h 30m", 1100 → "18h",
 * 30000 → "500h".
 *
 * Under ten hours it is `formatDuration`, word for word. It printed "3.5h"
 * here until 4 October 2026 while the headline above it said "3h 30m" for the
 * same extra time — two spellings of one figure on one card. Past ten hours
 * the minutes stop mattering at a glance and only the hour survives.
 */
export function shortHours(minutes: number): string {
  const m = Math.round(minutes);
  if (Math.abs(m) < 600) return formatDuration(m);
  return `${Math.round(m / 60).toLocaleString("en-US")}h`;
}

/** The step and top of a clean axis over `max` minutes, in whole hours. */
export function niceAxis(maxMinutes: number, ticks = 4): { top: number; step: number } {
  const hours = Math.max(maxMinutes / 60, 1);
  const raw = hours / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { top: Math.ceil(hours / step) * step * 60, step: step * 60 };
}
