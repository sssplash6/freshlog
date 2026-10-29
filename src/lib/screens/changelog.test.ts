import { describe, expect, it } from "vitest";

import { pastWeek } from "@/lib/screens/changelog";

const entry = (date: string, n: number, f: number) => ({ date, new: Array(n).fill("x"), fixed: Array(f).fill("y") });

describe("pastWeek", () => {
  it("adds up the days of the seven up to now, and none before", () => {
    const now = Date.UTC(2026, 9, 29, 12);
    expect(pastWeek([entry("2026-10-29", 2, 1), entry("2026-10-23", 1, 3), entry("2026-10-22", 5, 5)], now)).toEqual({ new: 3, fixed: 4 });
  });
});
