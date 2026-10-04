import { describe, expect, it } from "vitest";

import { formatBalance, formatDuration, formatMinutes, formatRough } from "@/lib/format";

/**
 * The owner asked for rounding because the exact figures had become
 * unreadable: "very many digits and I got a bit lost in them". These pin the
 * two halves of the answer — what rounds, and what the "+" is allowed to mean.
 */
describe("formatRough", () => {
  it("rounds a big total down to a five-hour step and says so", () => {
    // 7,807 minutes is 130h 07m. The program has at least 130 hours.
    expect(formatRough(7807)).toBe("130+ hours");
    expect(formatRough(74_400)).toBe("1,240 hours");
    expect(formatRough(74_460)).toBe("1,240+ hours");
  });

  it("never rounds up, because the plus would then be a lie", () => {
    // The transcription of the owner's note read "135+" for 130h 07m. Saying a
    // program has time it does not have is the one thing this must not do.
    expect(formatRough(7807)).not.toContain("135");
    for (const minutes of [601, 900, 7807, 12_345, 99_999]) {
      const claimed = Number(formatRough(minutes).replace(/[^\d]/g, ""));
      expect(claimed * 60).toBeLessThanOrEqual(minutes);
    }
  });

  it("drops the plus when the figure is exact", () => {
    expect(formatRough(600)).toBe("10 hours");
    expect(formatRough(120)).toBe("2 hours");
    expect(formatRough(60)).toBe("1 hour");
  });

  it("leaves anything under an hour alone", () => {
    // "45 min" is already the shortest true thing; "0+ hours" is not an answer.
    expect(formatRough(45)).toBe("45 min");
    expect(formatRough(0)).toBe("0 min");
  });

  it("keeps the hour precise below a hundred, where a five-hour step would erase it", () => {
    expect(formatRough(190)).toBe("3+ hours");
    expect(formatRough(599)).toBe("9+ hours");
    // 38h 45m beside a table row saying so; "35+" read as a different figure.
    expect(formatRough(2325)).toBe("38+ hours");
    expect(formatRough(5999)).toBe("99+ hours");
  });

  it("rounds the size of an overdraw, not its sign", () => {
    expect(formatRough(-1202)).toBe("-20+ hours");
  });

    it("costs the reader fewer digits than the figure it replaces", () => {
    // Not fewer characters — "1,240+ hours" is longer than "1241h". What was
    // asked for was fewer digits to hold in your head, and a word instead of a
    // second unit to parse. That is the thing to hold it to.
    for (const minutes of [7807, 74_460, 1202, 190]) {
      const digits = (s: string) => s.replace(/[^\d]/g, "").length;
      expect(digits(formatRough(minutes))).toBeLessThanOrEqual(
        digits(formatDuration(minutes))
      );
    }
  });
});

/**
 * One duration format app-wide: a row of "345 min" under a total of "5h 45m"
 * made the reader do the division to see one was part of the other.
 */
describe("formatMinutes", () => {
  it("reads like the totals beside it", () => {
    expect(formatMinutes(345)).toBe("5h 45m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(90)).toBe(formatDuration(90));
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(0)).toBe("0 min");
  });
});

describe("formatBalance", () => {
  it("says an overdraw as time over, never as negative time left", () => {
    expect(formatBalance(-540)).toBe("9h over");
    expect(formatBalance(-165)).toBe("2h 45m over");
    expect(formatBalance(-30)).toBe("30 min over");
  });

  it("leaves a balance that has not run out exactly as formatDuration says it", () => {
    expect(formatBalance(2325)).toBe("38h 45m");
    expect(formatBalance(0)).toBe("0 min");
  });
});
