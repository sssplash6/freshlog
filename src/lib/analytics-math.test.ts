import { describe, expect, it } from "vitest";

import type { AnalyticsRow } from "@/lib/analytics";
import {
  byDay,
  byMonth,
  change,
  hoursByProgram,
  niceAxis,
  rankBy,
  select,
  shortHours,
  totals,
  weeksOf,
  yearsOf,
} from "@/lib/analytics-math";

// [program, mentor, student, day, minutes, kind]
const ROWS: AnalyticsRow[] = [
  [0, 0, 0, 20260105, 60, 0],
  [0, 0, 1, 20260105, 30, 1], // extra
  [0, 1, 0, 20260210, 90, 0],
  [0, 1, 2, 20260211, 60, 2], // no-show
  [1, 0, 3, 20260910, 120, 0],
  [1, 0, 3, 20250910, 45, 0], // last year
];

describe("totals", () => {
  it("counts completed and extra as hours, and no-shows apart", () => {
    const t = totals(select(ROWS, { year: 2026 }));
    expect(t.completed).toBe(270);
    expect(t.extra).toBe(30);
    expect(t.hours).toBe(300);
    expect(t.noShow).toBe(60);
    expect(t.noShows).toBe(1);
    expect(t.sessions).toBe(4);
  });

  it("counts a student or mentor only when somebody actually met", () => {
    const t = totals(select(ROWS, { year: 2026, program: 0 }));
    // student 2 was a no-show, so they were not served
    expect(t.students).toBe(2);
    expect(t.mentors).toBe(2);
  });
});

describe("select", () => {
  it("narrows by month, program and mentor together", () => {
    const rows = select(ROWS, { year: 2026, month: 0, program: 0, mentor: 0 });
    expect(rows).toHaveLength(2);
  });
});

describe("byMonth and byDay", () => {
  it("buckets by the program day stored in the row", () => {
    const months = byMonth(select(ROWS, { year: 2026 }));
    expect(months[0].completed + months[0].extra).toBe(90);
    expect(months[8].completed).toBe(120);
    const days = byDay(ROWS, 2026, 1);
    expect(days).toHaveLength(28);
    expect(days[9].completed).toBe(90);
    expect(days[10].noShows).toBe(1);
  });
});

describe("rankBy", () => {
  it("ranks mentors by hours and keeps a whole-year trend", () => {
    const year = select(ROWS, { year: 2026, program: 0 });
    const ranked = rankBy(select(year, { year: 2026, month: 0 }), year, 1);
    expect(ranked.map((r) => r.index)).toEqual([0]);
    expect(ranked[0].hours).toBe(90);
    expect(ranked[0].trend[0]).toBe(90);
  });
});

describe("hoursByProgram", () => {
  it("sums each program's delivered hours across every year, no-shows apart", () => {
    // program 0: 60 + 30 extra + 90, the 60-minute no-show excluded
    // program 1: 120 this year + 45 last year — the grant gauge is all-time
    expect(hoursByProgram(ROWS, 2)).toEqual([180, 165]);
  });
});

describe("helpers", () => {
  it("lists every year with data plus the current one", () => {
    expect(yearsOf(ROWS, 2027)).toEqual([2027, 2026, 2025]);
  });

  it("refuses a percentage change from zero", () => {
    expect(change(60, 0)).toBeNull();
    expect(change(90, 60)).toBeCloseTo(0.5);
  });

  it("lays a year out in Monday-first weeks", () => {
    const weeks = weeksOf(2026);
    // 1 January 2026 is a Thursday
    expect(weeks[0].slice(0, 4)).toEqual([null, null, null, 20260101]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(365);
  });

  it("formats and scales hours", () => {
    expect(shortHours(45)).toBe("45m");
    expect(shortHours(90)).toBe("1.5h");
    expect(shortHours(1100)).toBe("18h");
    expect(niceAxis(7 * 60)).toEqual({ top: 8 * 60, step: 2 * 60 });
  });
});
