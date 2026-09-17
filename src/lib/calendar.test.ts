import { describe, expect, it } from "vitest";

import {
  addMonths,
  isoOf,
  monthGrid,
  msOf,
  startOfMonth,
  weekday,
} from "@/lib/calendar";

const at = (iso: string) => msOf(iso)!;

describe("msOf", () => {
  it("reads a day as UTC midnight, whatever the machine's timezone", () => {
    expect(new Date(at("2026-09-17")).toISOString()).toBe(
      "2026-09-17T00:00:00.000Z"
    );
  });

  it("refuses anything that is not a plain day", () => {
    for (const bad of ["", "17/09/2026", "2026-9-17", "today", undefined, null]) {
      expect(msOf(bad)).toBeNull();
    }
  });

  it("refuses a day that does not exist rather than rolling it forward", () => {
    // Date.parse("2026-02-31T00:00:00Z") is NaN in V8 but an engine that
    // rolled it to 3 March would otherwise hand the form a date nobody picked.
    expect(msOf("2026-02-31")).toBeNull();
    expect(msOf("2026-13-01")).toBeNull();
  });

  it("round-trips through isoOf", () => {
    for (const iso of ["2026-01-01", "2024-02-29", "2026-12-31"]) {
      expect(isoOf(at(iso))).toBe(iso);
    }
  });
});

describe("weekday", () => {
  it("counts from Monday, not Sunday", () => {
    // 2026-09-14 is a Monday.
    expect(weekday(at("2026-09-14"))).toBe(0);
    expect(weekday(at("2026-09-17"))).toBe(3);
    expect(weekday(at("2026-09-20"))).toBe(6); // Sunday closes the week
  });
});

describe("startOfMonth / addMonths", () => {
  it("lands on the first, from any day of the month", () => {
    expect(isoOf(startOfMonth(at("2026-09-30")))).toBe("2026-09-01");
  });

  it("crosses a year boundary in both directions", () => {
    expect(isoOf(addMonths(at("2026-12-15"), 1))).toBe("2027-01-01");
    expect(isoOf(addMonths(at("2026-01-15"), -1))).toBe("2025-12-01");
  });

  it("never overflows a short month", () => {
    // The bug this shape avoids: stepping from 31 January by one month lands
    // on 3 March if you keep the day.
    expect(isoOf(addMonths(at("2026-01-31"), 1))).toBe("2026-02-01");
  });
});

describe("monthGrid", () => {
  it("is always six rows of seven", () => {
    for (const iso of ["2026-02-01", "2026-09-01", "2026-08-01"]) {
      expect(monthGrid(at(iso))).toHaveLength(42);
    }
  });

  it("opens on the Monday on or before the first", () => {
    // 1 September 2026 is a Tuesday, so the grid opens on 31 August.
    expect(isoOf(monthGrid(at("2026-09-01"))[0])).toBe("2026-08-31");
  });

  it("opens on the first itself when the first IS a Monday", () => {
    // 1 June 2026 is a Monday — the row must not start a week early.
    expect(isoOf(monthGrid(at("2026-06-01"))[0])).toBe("2026-06-01");
  });

  it("covers every day of the month it is drawing", () => {
    const grid = monthGrid(at("2026-09-01")).map(isoOf);
    expect(grid).toContain("2026-09-01");
    expect(grid).toContain("2026-09-30");
  });

  it("holds February in a leap year without losing the 29th", () => {
    expect(monthGrid(at("2024-02-01")).map(isoOf)).toContain("2024-02-29");
  });

  it("runs consecutively, with no gap or repeat", () => {
    const grid = monthGrid(at("2026-09-01"));
    for (let i = 1; i < grid.length; i++) {
      expect(grid[i] - grid[i - 1]).toBe(86_400_000);
    }
  });
});
