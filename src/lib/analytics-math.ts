/**
 * The arithmetic behind the analytics dashboard, over the compact rows
 * `lib/analytics.ts` produces. Client-safe and pure, so every figure the
 * dashboard draws can be tested without a database.
 *
 * Every total is whole MINUTES. "Hours" on the dashboard means COMPLETED plus
 * EXTRA — time a mentor actually spent with a student present — and the two are
 * always shown apart as well, so the ledger's own "Completed" is never inflated
 * by out-of-plan work. No-shows are counted, never summed into hours.
 */

import type { AnalyticsRow } from "@/lib/analytics";

const KIND_COMPLETED = 0;
const KIND_EXTRA = 1;
const KIND_NO_SHOW = 2;

export type Filter = {
  year: number;
  /** 0–11, or null for the whole year. */
  month?: number | null;
  program?: number | null;
  mentor?: number | null;
};

export type Tally = {
  completed: number;
  extra: number;
  noShow: number;
  /** Attended sessions — no-shows are counted in `noShows`. */
  sessions: number;
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

/** Minutes a mentor spent with a student present, in plan or not. */
export function hoursOf(t: Tally): number {
  return t.completed + t.extra;
}

export function matches(row: AnalyticsRow, f: Filter): boolean {
  if (yearOf(row[3]) !== f.year) return false;
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
    if (r[5] !== KIND_NO_SHOW) {
      students.add(r[2]);
      mentors.add(r[1]);
    }
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

/** Hours per program index, per month: `[program][month]`. */
export function monthsByProgram(
  rows: readonly AnalyticsRow[],
  programCount: number
): number[][] {
  const grid = Array.from({ length: programCount }, () => new Array<number>(12).fill(0));
  for (const r of rows) {
    if (r[5] !== KIND_NO_SHOW) grid[r[0]][monthOf(r[3])] += r[4];
  }
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
    if (r[5] === KIND_NO_SHOW) continue;
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
    .sort((a, b) => b.hours - a.hours || b.sessions - a.sessions);
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
  for (const r of rows) {
    if (r[5] !== KIND_NO_SHOW) out.set(r[3], (out.get(r[3]) ?? 0) + r[4]);
  }
  return out;
}

/** A roll-up in hours, short: 45 → "45m", 90 → "1.5h", 1100 → "18h", 30000 → "500h". */
export function shortHours(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m}m`;
  const h = m / 60;
  if (h < 10) return `${Math.round(h * 10) / 10}h`;
  return `${Math.round(h).toLocaleString("en-US")}h`;
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
