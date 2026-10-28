import { describe, expect, it } from "vitest";

import { mentorStandings, overallStanding, type RatingTally } from "./mentor-standing";

function tally(
  mentorId: string,
  ratings: number[],
  extra: Partial<RatingTally> = {}
): RatingTally {
  return {
    mentorId,
    sum: ratings.reduce((a, b) => a + b, 0),
    count: ratings.length,
    last: null,
    lowestRecent: null,
    ...extra,
  };
}

describe("mentorStandings", () => {
  it("pools both kinds, so every rating counts once", () => {
    const [s] = mentorStandings(
      [tally("a", [4, 5])],
      [tally("a", [5, 5, 4, 3])]
    );
    expect(s.average).toBeCloseTo(26 / 6);
    expect(s.total).toBe(6);
    expect(s.general).toEqual({ count: 2, average: 4.5 });
    expect(s.meetings).toEqual({ count: 4, average: 4.25 });
  });

  it("keeps a mentor rated only on meetings", () => {
    const [s] = mentorStandings([], [tally("m", [3, 4, 5])]);
    expect(s.mentorId).toBe("m");
    expect(s.average).toBe(4);
    expect(s.general).toEqual({ count: 0, average: null });
  });

  it("orders worst first, and a tie by the more-rated mentor", () => {
    const order = mentorStandings(
      [tally("good", [5]), tally("few", [3]), tally("many", [3, 3])],
      [tally("bad", [1])]
    ).map((s) => s.mentorId);
    expect(order).toEqual(["bad", "many", "few", "good"]);
  });

  it("takes the later date and the lower recent rating across kinds", () => {
    const [s] = mentorStandings(
      [tally("a", [5], { last: new Date("2026-10-01"), lowestRecent: 4 })],
      [tally("a", [2], { last: new Date("2026-10-05"), lowestRecent: 2 })]
    );
    expect(s.lastRated).toEqual(new Date("2026-10-05"));
    expect(s.lowestRecent).toBe(2);
  });

  it("drops an empty tally", () => {
    expect(mentorStandings([tally("a", [])], [])).toEqual([]);
  });
});

describe("overallStanding", () => {
  it("weights each mentor by their ratings", () => {
    const all = mentorStandings([tally("a", [5])], [tally("b", [2, 2, 2])]);
    expect(overallStanding(all)).toEqual({ average: 11 / 4, total: 4 });
  });

  it("has no average with no ratings", () => {
    expect(overallStanding([])).toEqual({ average: null, total: 0 });
  });
});
