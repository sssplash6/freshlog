import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { mentorWindow } from "@/lib/mentor-window";

/**
 * The range a mentor's figures are read through. Four things matter, and the
 * last is the one that would be wrong quietly: a range the reader typed wrongly
 * must fall back to the default ninety days, not to "all time" — which is what
 * the shared parser answers for an empty window, and which would show a
 * lifetime total under a label the reader never chose.
 */
const NOW = new Date("2026-10-02T12:00:00.000Z");

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

const day = (d?: Date) => d?.toISOString().slice(0, 10);

describe("mentorWindow", () => {
  it("reads ninety days when nothing is chosen, and says which days", () => {
    const w = mentorWindow({}, NOW);
    expect(w.kind).toBe("90d");
    expect(day(w.from)).toBe("2026-07-05");
    expect(w.label).toBe("last 90 days (July 5 – October 2)");
  });

  it("reads thirty days, counting today as one of them", () => {
    const w = mentorWindow({ period: "30d" }, NOW);
    expect(w.kind).toBe("30d");
    expect(day(w.from)).toBe("2026-09-03");
    expect(w.label).toBe("last 30 days (September 3 – October 2)");
  });

  it("reads all time with no bounds at all", () => {
    const w = mentorWindow({ period: "all" }, NOW);
    expect(w).toMatchObject({ kind: "all", label: "all time" });
    expect(w.from).toBeUndefined();
    expect(w.to).toBeUndefined();
  });

  it("reads a typed range, inclusive of the last day", () => {
    const w = mentorWindow({ period: "custom", from: "2026-09-01", to: "2026-09-30" }, NOW);
    expect(w.kind).toBe("custom");
    expect(day(w.from)).toBe("2026-09-01");
    expect(w.to?.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    expect(w.label).toBe("September 1 – September 30");
    expect(w.fromValue).toBe("2026-09-01");
    expect(w.toValue).toBe("2026-09-30");
  });

  it("puts a backwards range the right way round", () => {
    const w = mentorWindow({ from: "2026-09-30", to: "2026-09-01" }, NOW);
    expect(w.label).toBe("September 1 – September 30");
    expect(w.fromValue).toBe("2026-09-01");
  });

  it("lets a typed range beat a preset", () => {
    const w = mentorWindow({ period: "30d", from: "2026-09-01", to: "2026-09-30" }, NOW);
    expect(w.kind).toBe("custom");
  });

  it("says an open end in words", () => {
    expect(mentorWindow({ from: "2026-09-01" }, NOW).label).toBe("from September 1");
    const until = mentorWindow({ to: "2026-09-30" }, NOW);
    expect(until.label).toBe("until September 30");
    expect(until.from).toBeUndefined();
  });

  it("names a single day once", () => {
    expect(mentorWindow({ from: "2026-09-15", to: "2026-09-15" }, NOW).label).toBe("September 15");
  });

  it("names the year when a range leaves this one", () => {
    const w = mentorWindow({ from: "2025-12-15", to: "2026-01-10" }, NOW);
    expect(w.label).toBe("December 15, 2025 – January 10");
  });

  it("falls back to ninety days for dates that are not days", () => {
    for (const params of [
      { from: "2026-02-31", to: "nonsense" },
      { period: "custom" },
      { period: "custom", from: "", to: "" },
      { period: "banana" },
    ]) {
      const w = mentorWindow(params, NOW);
      expect(w.kind, JSON.stringify(params)).toBe("90d");
      expect(w.from).toBeDefined();
    }
  });

  it("keeps all time when the reader asked for it, whatever else was typed", () => {
    expect(mentorWindow({ period: "all", from: "junk" }, NOW).kind).toBe("all");
  });

  it("hands back nothing to pre-fill when the range is a preset", () => {
    const w = mentorWindow({ period: "30d" }, NOW);
    expect(w.fromValue).toBe("");
    expect(w.toValue).toBe("");
  });
});
