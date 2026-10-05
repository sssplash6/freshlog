import { describe, expect, it } from "vitest";

import { describeSessionChange } from "@/lib/session-change";

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("describeSessionChange", () => {
  it("says only the date moved, with both years", () => {
    expect(
      describeSessionChange(
        { minutes: 30, date: day("2026-10-24") },
        { minutes: 30, date: day("2026-09-24") }
      )
    ).toBe("moved to September 24, 2026 (was October 24, 2026)");
  });

  it("says only the length changed, without repeating the date", () => {
    expect(
      describeSessionChange(
        { minutes: 30, date: day("2026-09-24") },
        { minutes: 45, date: day("2026-09-24") }
      )
    ).toBe("now 45 min (was 30 min)");
  });

  it("says both when both changed", () => {
    expect(
      describeSessionChange(
        { minutes: 60, date: day("2026-10-24") },
        { minutes: 90, date: day("2026-09-24") }
      )
    ).toBe(
      "now 1h 30m (was 1h), moved to September 24, 2026 (was October 24, 2026)"
    );
  });

  it("names where the session stands when neither figure moved", () => {
    expect(
      describeSessionChange(
        { minutes: 30, date: day("2026-09-24") },
        { minutes: 30, date: day("2026-09-24") }
      )
    ).toBe("30 min on September 24, 2026");
  });

  it("keeps the year when the date crosses one", () => {
    expect(
      describeSessionChange(
        { minutes: 30, date: day("2025-12-31") },
        { minutes: 30, date: day("2026-01-01") }
      )
    ).toContain("January 1, 2026 (was December 31, 2025)");
  });
});
