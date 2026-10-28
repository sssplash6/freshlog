import { describe, expect, it } from "vitest";

import { slotTime } from "@/lib/api/v1/practice";

/**
 * A slot is stored as the Tashkent wall clock in a UTC field. On the wire it is
 * the day and time a student typed, and the real instants five hours earlier.
 */
describe("slotTime", () => {
  it("keeps the day a student typed just after midnight, and starts the day before in UTC", () => {
    expect(slotTime({ startsAt: new Date("2026-11-03T00:30:00.000Z"), minutes: 45 })).toEqual({
      day: "2026-11-03",
      time: "00:30",
      minutes: 45,
      startsAt: "2026-11-02T19:30:00.000Z",
      endsAt: "2026-11-02T20:15:00.000Z",
    });
  });

  it("reads a late evening time on its own day", () => {
    expect(slotTime({ startsAt: new Date("2026-11-03T23:30:00.000Z"), minutes: 60 })).toMatchObject({
      day: "2026-11-03",
      time: "23:30",
      startsAt: "2026-11-03T18:30:00.000Z",
      endsAt: "2026-11-03T19:30:00.000Z",
    });
  });
});
