/**
 * The Analytics dashboard's own readings of its view, moved from
 * `app/analytics/dashboard.tsx` unchanged so the freshlog app reads the same
 * period, presets and comparison: which days a view covers, the windows the
 * presets offer, a period's words, and the hero's comparison and busiest
 * month. Client-safe and pure, like `analytics-math.ts`, which it reads.
 */

import type { AnalyticsRow } from "@/lib/analytics";
import {
  byMonth,
  dateOf,
  dayKeyOf,
  hoursOf,
  monthOf,
  select,
  totals,
  windowBefore,
  yearOf,
  type Filter,
} from "@/lib/analytics-math";
import { DAY, weekday } from "@/lib/calendar";

/**
 * What the page calls its parts. The school's are programs; an institute's are
 * its levels, handed over in the same `programs` slots (`instituteAnalyticsData`)
 * so the drill itself never has to know which it is reading — only the words do.
 */
export type Frame =
  | { kind: "school" }
  | { kind: "institute"; name: string };

export type Words = {
  all: string;
  allChip: string;
  across: string;
  parts: string;
  top: string;
  topMentor: string;
  inOne: string;
  inOneMentor: string;
};

export function wordsFor(frame: Frame): Words {
  if (frame.kind === "institute") {
    return {
      all: frame.name,
      allChip: "All levels",
      across: `Hours mentors spent with students, across ${frame.name}.`,
      parts: "Levels",
      top: `Top mentors in ${frame.name}`,
      topMentor: `Mentors in ${frame.name}`,
      inOne: "Who delivered the most",
      inOneMentor: "Mentors at this level",
    };
  }
  return {
    all: "All programs",
    allChip: "All programs",
    across: "Hours mentors spent with students, across every program.",
    parts: "Programs",
    top: "Top mentors across the school",
    topMentor: "Mentors across the school",
    inOne: "Who delivered the most",
    inOneMentor: "Mentors in this program",
  };
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type Today = { year: number; month: number; day: number };
export type View = {
  year: number;
  month: number | null;
  /** A window of chosen days, yyyymmdd, both ends kept. Never set with `month`. */
  from: number | null;
  to: number | null;
  program: number | null;
  mentor: number | null;
};

export type Preset = { label: string; phrase: string; from: number; to: number };

/** Which days the view reads: its window when it has one, else its month or its year. */
export function periodOf(view: View): Filter {
  return view.from != null ? { from: view.from, to: view.to } : { year: view.year, month: view.month };
}

/** The same windows the list filters offer one click to (`DATE_PRESETS`), counted to today. */
export function presetsFor(today: Today): Preset[] {
  const now = Date.UTC(today.year, today.month, today.day);
  const end = dayKeyOf(now);
  const back = (days: number) => dayKeyOf(now - (days - 1) * DAY);
  return [
    // The calendar week, Monday to today, as the lists count it.
    { label: "This week", phrase: "this week", from: dayKeyOf(now - weekday(now) * DAY), to: end },
    { label: "Last 30 days", phrase: "the last 30 days", from: back(30), to: end },
    { label: "Last 90 days", phrase: "the last 90 days", from: back(90), to: end },
  ];
}

/** "Sep 15–Oct 14", the year added only where it is not this one. */
export function spanOf(from: number, to: number, today: Today): string {
  const crosses = yearOf(from) !== yearOf(to);
  const day = (k: number) => `${MONTHS[monthOf(k)]} ${dateOf(k)}${crosses ? `, ${yearOf(k)}` : ""}`;
  const tail = !crosses && yearOf(to) !== today.year ? `, ${yearOf(to)}` : "";
  if (from === to) return day(from) + tail;
  if (!crosses && monthOf(from) === monthOf(to)) return `${day(from)}–${dateOf(to)}${tail}`;
  return `${day(from)}–${day(to)}${tail}`;
}

/** The period inside a sentence: "October", "2026", "the last 30 days", "Sep 3–17". */
export function periodLabel(view: View, today: Today): string {
  if (view.from != null && view.to != null) {
    const preset = presetsFor(today).find((p) => p.from === view.from && p.to === view.to);
    return preset?.phrase ?? spanOf(view.from, view.to, today);
  }
  return view.month != null ? MONTHS_LONG[view.month] : String(view.year);
}

/**
 * What the hero sets the period's hours against: the window before a window of
 * days, the month before a month (to the same day while it runs), the year
 * before a year (to the same day while it runs).
 */
export function heroCompare(
  allRows: readonly AnalyticsRow[],
  view: View,
  today: Today,
  periodRows: readonly AnalyticsRow[],
  hours: number
): { before: number; now: number; against: string } {
  const { year, month, from, to, program, mentor } = view;
  const t = { hours };
  const data = { rows: allRows };
  const scope = { program, mentor };
  // Chosen days against as many days just before them.
  if (from != null && to != null) {
    const [a, b] = windowBefore(from, to);
    return { before: totals(select(data.rows, { from: a, to: b, ...scope })).hours, now: t.hours, against: spanOf(a, b, today) };
  }
  if (month != null) {
    const py = month === 0 ? year - 1 : year;
    const pm = month === 0 ? 11 : month - 1;
    const running = year === today.year && month === today.month;
    const rows = select(data.rows, { year: py, month: pm, ...scope }).filter(
      (r) => !running || dateOf(r[3]) <= today.day
    );
    const against = running ? `${MONTHS[pm]} 1–${today.day}` : MONTHS_LONG[pm];
    const nowRows = running ? periodRows.filter((r) => dateOf(r[3]) <= today.day) : periodRows;
    return { before: totals(rows).hours, now: totals(nowRows).hours, against };
  }
  const running = year === today.year;
  const rows = select(data.rows, { year: year - 1, ...scope }).filter(
    (r) =>
      !running ||
      monthOf(r[3]) < today.month ||
      (monthOf(r[3]) === today.month && dateOf(r[3]) <= today.day)
  );
  return {
    before: totals(rows).hours,
    now: t.hours,
    against: running ? `the same period of ${year - 1}` : String(year - 1),
  };
}

/** The busiest month of the year's rows, or null when none has hours. */
export function busiestMonth(yearRows: readonly AnalyticsRow[]): { month: number; minutes: number } | null {
  const months = byMonth(yearRows);
  let best = -1;
  months.forEach((m, i) => {
    if (hoursOf(m) > 0 && (best < 0 || hoursOf(m) > hoursOf(months[best]))) best = i;
  });
  return best < 0 ? null : { month: best, minutes: hoursOf(months[best]) };
}
