import { describe, expect, it } from "vitest";

import { formatTimeOfDay, programToday } from "@/lib/when";

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

describe("programToday", () => {
  it("is the program's day, not UTC's, in the hours they disagree", () => {
    // 21:00 UTC on the 15th is already 02:00 on the 16th in Tashkent. This is
    // the window the log form's `max` was wrong in: a mentor working after
    // midnight could not pick the day they were living in.
    expect(programToday(new Date("2026-09-15T21:00:00Z"))).toBe("2026-09-16");
  });

  it("is the same day as UTC for the other nineteen hours", () => {
    expect(programToday(new Date("2026-09-15T12:00:00Z"))).toBe("2026-09-15");
    expect(programToday(new Date("2026-09-15T18:59:00Z"))).toBe("2026-09-15");
  });

  it("does not depend on where the reader is", () => {
    // The same instant, asked for by a mentor in New York and one in Tashkent.
    // A session is dated by the program's calendar, so both must be told the
    // same day — the US mentor was being handed UTC's, which is a third answer.
    const instant = new Date("2026-09-16T02:00:00Z");
    expect(programToday(instant)).toBe("2026-09-16");
  });
});
