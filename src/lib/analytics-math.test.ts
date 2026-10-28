import { describe, expect, it } from "vitest";

import { kindOf, SESSION_KIND, type AnalyticsRow } from "@/lib/analytics";
import {
  byDay,
  byMonth,
  change,
  drawnByProgram,
  hoursByDay,
  meetingsOf,
  niceAxis,
  rankBy,
  select,
  shortHours,
  totals,
  weeksOf,
  windowBefore,
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
  it("counts completed, extra and missed as hours, each kept apart", () => {
    const t = totals(select(ROWS, { year: 2026 }));
    expect(t.completed).toBe(270);
    expect(t.extra).toBe(30);
    expect(t.noShow).toBe(60);
    expect(t.hours).toBe(360);
    expect(t.noShows).toBe(1);
    expect(t.sessions).toBe(4);
    expect(meetingsOf(t)).toBe(5);
  });

  it("counts the student and mentor of a missed meeting", () => {
    const t = totals(select(ROWS, { year: 2026, program: 0 }));
    // student 2 missed, but the mentor held the time for them
    expect(t.students).toBe(3);
    expect(t.mentors).toBe(2);
  });

  it("credits a mentor whose only meeting in the period was missed", () => {
    const missedOnly = ROWS.filter((r) => r[3] === 20260211);
    const ranked = rankBy(missedOnly, missedOnly, 1);
    expect(ranked.map((r) => r.index)).toEqual([1]);
    expect(ranked[0].hours).toBe(60);
    expect(ranked[0].noShow).toBe(60);
    expect(ranked[0].trend[1]).toBe(60);
    expect(hoursByDay(ROWS).get(20260211)).toBe(60);
  });
});

describe("select", () => {
  it("narrows by month, program and mentor together", () => {
    const rows = select(ROWS, { year: 2026, month: 0, program: 0, mentor: 0 });
    expect(rows).toHaveLength(2);
  });

  it("narrows to a window of days, both ends kept, across a new year", () => {
    expect(select(ROWS, { from: 20250910, to: 20260105 })).toHaveLength(3);
    expect(select(ROWS, { from: 20260106, to: 20260210, program: 0 })).toHaveLength(1);
  });

  it("compares a window with the same number of days just before it", () => {
    expect(windowBefore(20260915, 20261014)).toEqual([20260816, 20260914]);
    expect(windowBefore(20260101, 20260107)).toEqual([20251225, 20251231]);
    expect(windowBefore(20260301, 20260301)).toEqual([20260228, 20260228]);
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

describe("drawnByProgram", () => {
  it("sums what each program's grant paid for, across every year", () => {
    // program 0: 60 + 90 + the 60-minute missed meeting, which the ledger
    // charged like any other; the 30 extra minutes charged nobody
    // program 1: 120 this year + 45 last year — the grant gauge is all-time
    expect(drawnByProgram(ROWS, 2)).toEqual([210, 165]);
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
    expect(shortHours(45)).toBe("45 min");
    expect(shortHours(90)).toBe("1h 30m");
    expect(shortHours(0)).toBe("0 min");
    expect(shortHours(1100)).toBe("18h");
    expect(niceAxis(7 * 60)).toEqual({ top: 8 * 60, step: 2 * 60 });
  });
});

describe("kindOf", () => {
  it("asks the plan first, as the ledger does", () => {
    expect(kindOf({ withinPlan: true, attended: true })).toBe(SESSION_KIND.COMPLETED);
    expect(kindOf({ withinPlan: true, attended: false })).toBe(SESSION_KIND.NO_SHOW);
    // out of plan charges nobody, so it is extra whether or not they came
    expect(kindOf({ withinPlan: false, attended: false })).toBe(SESSION_KIND.EXTRA);
    expect(kindOf({ withinPlan: false, attended: true })).toBe(SESSION_KIND.EXTRA);
  });
});
