import { describe, expect, it } from "vitest";

import {
  areClassmates,
  formatSlotSpan,
  interviewPhase,
  overlaps,
  parseSlotLength,
  parseSlotStart,
} from "@/lib/peer-interviews";

/** 12:00 UTC is 17:00 in Tashkent — the clock every time here is read on. */
const NOW = new Date("2026-09-03T12:00:00.000Z");
const at = (iso: string) => new Date(`${iso}:00.000Z`);

describe("parseSlotStart", () => {
  it("stores the wall clock the student typed", () => {
    expect(parseSlotStart("2026-09-04", "15:00", NOW)).toEqual({
      value: at("2026-09-04T15:00"),
    });
  });

  it("refuses a time already gone on Tashkent's clock, even if not on UTC's", () => {
    // 16:00 Tashkent is an hour ago; read as UTC it would be four hours away.
    expect(parseSlotStart("2026-09-03", "16:00", NOW)).toHaveProperty("error");
    expect(parseSlotStart("2026-09-03", "18:00", NOW)).toHaveProperty("value");
  });

  it("refuses a time past the booking window", () => {
    expect(parseSlotStart("2026-12-01", "10:00", NOW)).toHaveProperty("error");
  });

  it("refuses a malformed time", () => {
    expect(parseSlotStart("2026-09-04", "25:00", NOW)).toHaveProperty("error");
    expect(parseSlotStart("", "10:00", NOW)).toHaveProperty("error");
  });
});

describe("parseSlotLength", () => {
  it("takes only the lengths the form offers", () => {
    expect(parseSlotLength("45")).toBe(45);
    expect(parseSlotLength("50")).toBeNull();
    expect(parseSlotLength(null)).toBeNull();
  });
});

describe("overlaps", () => {
  const nine = { startsAt: at("2026-09-04T09:00"), minutes: 60 };

  it("sees a shared minute", () => {
    expect(overlaps(nine, { startsAt: at("2026-09-04T09:30"), minutes: 30 })).toBe(true);
  });

  it("lets two times sit back to back", () => {
    expect(overlaps(nine, { startsAt: at("2026-09-04T10:00"), minutes: 30 })).toBe(false);
  });
});

describe("areClassmates", () => {
  it("is true when the two share one of their own programs", () => {
    expect(
      areClassmates(
        [{ programId: "global" }, { programId: "imkon" }],
        [{ programId: "imkon", exchangeId: null }]
      )
    ).toBe(true);
  });

  it("does not count a program either of them is only visiting", () => {
    const visitor = [
      { programId: "imkon", exchangeId: null },
      { programId: "global", exchangeId: "ex1" },
    ];
    const local = [{ programId: "global", exchangeId: null }];
    expect(areClassmates(visitor, local)).toBe(false);
    expect(areClassmates(local, visitor)).toBe(false);
  });
});

describe("interviewPhase", () => {
  const slot = { startsAt: at("2026-09-03T18:00"), minutes: 45 };

  it("is booked until it starts, then waits to be marked", () => {
    expect(interviewPhase({ completedAt: null, slot }, NOW)).toBe("booked");
    expect(
      interviewPhase({ completedAt: null, slot }, new Date("2026-09-03T13:05:00Z"))
    ).toBe("to-mark");
  });

  it("is completed once somebody says so", () => {
    expect(interviewPhase({ completedAt: NOW, slot }, NOW)).toBe("completed");
  });
});

describe("formatSlotSpan", () => {
  it("names the start and the end", () => {
    expect(formatSlotSpan({ startsAt: at("2026-09-04T09:30"), minutes: 45 })).toBe(
      "09:30–10:15"
    );
  });
});
