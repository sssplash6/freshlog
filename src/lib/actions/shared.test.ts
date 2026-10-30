import { describe, expect, it } from "vitest";

import { FULL_NAME_RE, parseDateField, parseMinutesField, parseNameField } from "@/lib/actions/shared";

/**
 * A name is now required to be a FULL name, everywhere one is typed: your own
 * at /settings, a mentor's at registration, a student's on the roster form.
 * Every one of those forms already said "Full name" and every one of them
 * accepted "Malika".
 */
describe("parseNameField", () => {
  it("takes a first and last name, and collapses the spacing", () => {
    expect(parseNameField("Malika Karimova")).toEqual({
      value: "Malika Karimova",
    });
    expect(parseNameField("  Malika   Karimova  ")).toEqual({
      value: "Malika Karimova",
    });
  });

  it("refuses one word, and says which half is missing", () => {
    const result = parseNameField("Malika", "their");
    expect(result).toEqual({
      error: "Enter their full name — first and last, not just one word.",
    });
  });

  it("refuses an empty field with the shorter sentence", () => {
    expect(parseNameField("", "your")).toEqual({
      error: "Enter your full name.",
    });
    expect(parseNameField("   ")).toEqual({ error: "Enter their full name." });
    expect(parseNameField(null, "the mentor's")).toEqual({
      error: "Enter the mentor's full name.",
    });
  });

  it("is a completeness check, not a spelling one", () => {
    // Middle names, particles, hyphens, apostrophes and transliterations are
    // all names people actually have here. None of them is this rule's
    // business — only whether there is more than one part.
    for (const name of [
      "Ma'mur Abdulla-Ogli",
      "Jean-Luc de la Fontaine",
      "Гулнора Каримова",
      "O'Brien Smith",
    ]) {
      expect(parseNameField(name)).toEqual({ value: name });
    }
  });

  it("caps at what User.name holds", () => {
    expect(parseNameField(`${"a".repeat(78)} b`)).toEqual({
      value: `${"a".repeat(78)} b`,
    });
    expect(parseNameField(`${"a".repeat(79)} b`)).toEqual({
      error: "That name is too long (80 characters max).",
    });
  });
});

/**
 * The browser half of the same rule. `NameInput` feeds this pattern to the
 * input after stripping its anchors, so a divergence here is a form that
 * refuses in place what the server would have taken, or the reverse.
 */
describe("FULL_NAME_RE as an input pattern", () => {
  const asPattern = new RegExp(
    `^(?:${FULL_NAME_RE.source.replace(/^\^|\$$/g, "")})$`
  );

  it("agrees with the server on the same values", () => {
    for (const name of ["Malika Karimova", "A B C", "Malika", "", " "]) {
      expect(asPattern.test(name)).toBe("value" in parseNameField(name));
    }
  });
});

/**
 * One session is a day at the very most: the October 2026 audit found
 * 99,999,999 minutes accepted by the form. A grant keeps the year-long ceiling
 * because a grant is a pile of hours, not one meeting.
 */
describe("parseMinutesField ceiling", () => {
  it("refuses more than the caller's maximum, and says what it is", () => {
    expect(parseMinutesField("1441", { min: 1, max: 1440, label: "Minutes" })).toEqual({
      error: "Minutes can be at most 1440 (24 hours).",
    });
    expect(parseMinutesField("1440", { min: 1, max: 1440, label: "Minutes" })).toEqual({
      value: 1440,
    });
  });

  it("keeps the old ceiling for a caller that names none", () => {
    expect(parseMinutesField("100000", { min: 1, label: "Minutes" })).toEqual({
      value: 100000,
    });
  });
});

describe("parseDateField", () => {
  it("stores a day at UTC midnight", () => {
    expect(parseDateField("2028-02-29")).toEqual({ value: new Date("2028-02-29T00:00:00.000Z") });
  });

  it("refuses a day that does not exist, rather than rolling it into the next month", () => {
    // 31 February had been saved as 3 March, and 29 February 2026 as 1 March.
    expect(parseDateField("2026-02-31")).toEqual({ error: "Pick a valid date." });
    expect(parseDateField("2026-02-29")).toEqual({ error: "Pick a valid date." });
  });
});
