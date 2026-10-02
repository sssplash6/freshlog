import { describe, expect, it } from "vitest";

import {
  BUG_STATUSES,
  isBugStatus,
  readTriageFilter,
  resolutionPrefill,
  sanitizePagePath,
} from "@/lib/bugs";

describe("sanitizePagePath", () => {
  it("keeps a path and drops the query string and fragment", () => {
    expect(sanitizePagePath("/mentors/abc?period=30d#x")).toBe("/mentors/abc");
    expect(sanitizePagePath("/")).toBe("/");
    expect(sanitizePagePath("  /students/1  ")).toBe("/students/1");
  });

  it("drops everything that is not one of our own paths", () => {
    for (const bad of [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/a//b",
      "evil.com/path",
      "?only=query",
      "",
      "/with\u0000nul",
      "/tab\there",
    ]) {
      expect(sanitizePagePath(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("drops what is not a string", () => {
    for (const bad of [undefined, null, 42, {}, ["/a"]]) {
      expect(sanitizePagePath(bad)).toBeNull();
    }
  });

  it("allows 300 characters and not 301", () => {
    expect(sanitizePagePath("/" + "a".repeat(299))).not.toBeNull();
    expect(sanitizePagePath("/" + "a".repeat(300))).toBeNull();
  });
});

describe("isBugStatus", () => {
  it("accepts the four statuses and nothing else", () => {
    for (const s of BUG_STATUSES) expect(isBugStatus(s)).toBe(true);
    for (const bad of ["fixed", "DONE", "", null, undefined, 1]) {
      expect(isBugStatus(bad)).toBe(false);
    }
  });
});

describe("readTriageFilter", () => {
  it("opens on Pending and In progress", () => {
    expect(readTriageFilter("")).toBe("open");
    expect(readTriageFilter("banana")).toBe("open");
  });

  it("reads a status or all", () => {
    expect(readTriageFilter("FIXED")).toBe("FIXED");
    expect(readTriageFilter("PENDING")).toBe("PENDING");
    expect(readTriageFilter("all")).toBe("all");
  });
});

describe("resolutionPrefill", () => {
  it("offers the stored line only to the status it was written for", () => {
    expect(resolutionPrefill("FIXED", "FIXED", "Totals now add up.")).toBe("Totals now add up.");
    expect(resolutionPrefill("CLOSED", "CLOSED", "Works as designed.")).toBe("Works as designed.");
  });

  it("never turns a private Closed note into the public fix line, or the reverse", () => {
    const note = "Duplicate - Bekzod entered Aziza's hours twice";
    expect(resolutionPrefill("FIXED", "CLOSED", note)).toBe("");
    expect(resolutionPrefill("CLOSED", "FIXED", "Public fix line")).toBe("");
  });

  it("starts empty for a report that was reopened, whatever it once said", () => {
    for (const current of ["PENDING", "IN_PROGRESS"] as const) {
      expect(resolutionPrefill("FIXED", current, "old line")).toBe("");
      expect(resolutionPrefill("CLOSED", current, "old note")).toBe("");
    }
  });

  it("is empty when there is nothing stored", () => {
    expect(resolutionPrefill("FIXED", "FIXED", null)).toBe("");
  });
});
