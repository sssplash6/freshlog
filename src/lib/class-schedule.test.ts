import { describe, expect, it } from "vitest";

import {
  CLASS_STATUS,
  fitsAllocation,
  monthKey,
  monthLabel,
  monthRange,
  monthTotals,
  reservedMinutes,
  shiftMonth,
  type ClassRow,
} from "@/lib/class-schedule";

const row = (over: Partial<ClassRow>): ClassRow => ({
  studentId: "s1",
  mentorId: "m1",
  startsAt: new Date("2026-10-10T10:00:00Z"),
  minutes: 60,
  status: CLASS_STATUS.SCHEDULED,
  ...over,
});

describe("month keys", () => {
  it("round-trips a month", () => {
    expect(monthKey(new Date("2026-10-31T23:59:00Z"))).toBe("2026-10");
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(monthLabel("2026-13")).toBeNull();
    expect(monthRange("nope")).toBeNull();
  });

  it("steps across a year", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});

describe("reservedMinutes", () => {
  it("reserves only classes still to come", () => {
    expect(
      reservedMinutes([
        row({ minutes: 60 }),
        row({ minutes: 30, status: CLASS_STATUS.HELD }),
        row({ minutes: 90, status: CLASS_STATUS.CANCELLED }),
      ])
    ).toBe(60);
  });
});

describe("fitsAllocation", () => {
  it("refuses a class that would promise more than is left", () => {
    expect(fitsAllocation(120, 60, 60)).toBe(true);
    expect(fitsAllocation(120, 60, 61)).toBe(false);
    expect(fitsAllocation(0, 0, 30)).toBe(false);
  });
});

describe("monthTotals", () => {
  const october = monthRange("2026-10")!;

  it("adds each student's month, across mentors", () => {
    const totals = monthTotals(
      [
        row({ minutes: 60 }),
        row({ mentorId: "m2", minutes: 45, status: CLASS_STATUS.HELD }),
        row({ studentId: "s2", minutes: 30 }),
      ],
      october
    );
    expect(totals.get("s1")).toMatchObject({ scheduled: 60, held: 45, total: 105, classes: 2 });
    expect(totals.get("s2")?.total).toBe(30);
  });

  it("keeps cancelled time out of the total but on the row", () => {
    const t = monthTotals([row({ minutes: 60, status: CLASS_STATUS.CANCELLED })], october);
    expect(t.get("s1")).toMatchObject({ cancelled: 60, total: 0, classes: 0 });
  });

  it("counts the 1st and the 31st in their own month, and nothing outside", () => {
    const totals = monthTotals(
      [
        row({ startsAt: new Date("2026-10-01T00:00:00Z"), minutes: 10 }),
        row({ startsAt: new Date("2026-10-31T23:59:00Z"), minutes: 20 }),
        row({ startsAt: new Date("2026-11-01T00:00:00Z"), minutes: 40 }),
        row({ startsAt: new Date("2026-09-30T23:59:00Z"), minutes: 80 }),
      ],
      october
    );
    expect(totals.get("s1")?.total).toBe(30);
  });
});
