import { describe, expect, it } from "vitest";

import { formatTimeOfDay } from "@/lib/when";

/**
 * The bug this file exists for, stated as a test.
 *
 * Meeting times are stored as the program's wall clock in a UTC field, and
 * `now` is a real instant. Comparing them directly puts them on different
 * calendar days for the five hours after midnight in Tashkent — the exact hours
 * when a mentor checks the day's schedule.
 */

describe("formatTimeOfDay", () => {
  it("names the zone the time means", () => {
    expect(formatTimeOfDay(new Date("2026-09-04T15:00:00Z"), true)).toBe("15:00 Tashkent");
  });

  it("pads to a stable width so a column of times lines up", () => {
    expect(formatTimeOfDay(new Date("2026-09-04T09:05:00Z"), true)).toBe("09:05 Tashkent");
  });

  it("says nothing when only a date was given", () => {
    expect(formatTimeOfDay(new Date("2026-09-04T00:00:00Z"), false)).toBeNull();
  });
});
