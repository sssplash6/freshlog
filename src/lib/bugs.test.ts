import { describe, expect, it } from "vitest";

import {
  BUG_STATUSES,
  captionTitle,
  diagnosticsLine,
  isBugStatus,
  readDiagnostics,
  readTriageFilter,
  reportPagePath,
  resolutionPrefill,
  sanitizePagePath,
  shortBuild,
  summarizeUserAgent,
} from "@/lib/bugs";

const MAC_CHROME_141 =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Real user agents, one per browser and system the summary names. */
const UA_CASES: [string, string, string][] = [
  ["Chrome on macOS", MAC_CHROME_141, "Chrome 141 on macOS"],
  [
    "Safari on iOS",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
    "Safari 18 on iOS",
  ],
  [
    "Firefox on Windows",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
    "Firefox 143 on Windows",
  ],
  [
    "Edge on Windows",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
    "Edge 141 on Windows",
  ],
  [
    "Samsung Internet on Android",
    "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
    "Samsung Internet 28 on Android",
  ],
  [
    "Chrome on iOS",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
    "Chrome 141 on iOS",
  ],
  [
    "Chrome on Android",
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
    "Chrome 141 on Android",
  ],
  [
    "Firefox on Linux",
    "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
    "Firefox 143 on Linux",
  ],
];

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
  it("accepts the five statuses and nothing else", () => {
    for (const s of BUG_STATUSES) expect(isBugStatus(s)).toBe(true);
    expect(BUG_STATUSES).toContain("IN_REVIEW");
    for (const bad of ["fixed", "DONE", "", null, undefined, 1]) {
      expect(isBugStatus(bad)).toBe(false);
    }
  });
});

describe("readTriageFilter", () => {
  it("shows both kinds unless one is asked for", () => {
    expect(readTriageFilter("")).toBe("all");
    expect(readTriageFilter("banana")).toBe("all");
    expect(readTriageFilter("FIXED")).toBe("all");
  });

  it("reads a kind", () => {
    expect(readTriageFilter("BUG")).toBe("BUG");
    expect(readTriageFilter("FEATURE")).toBe("FEATURE");
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

describe("captionTitle", () => {
  it("is the first non-empty line, trimmed", () =>
    expect(captionTitle("\n\n  Make this card bigger  \nit is tiny")).toBe("Make this card bigger"));
  it("keeps a 120-character line whole", () =>
    expect(captionTitle("a".repeat(120))).toBe("a".repeat(120)));
  it("cuts a longer line to 120 with an ellipsis", () =>
    expect(captionTitle("a".repeat(121))).toBe("a".repeat(119) + "…"));
});

describe("readDiagnostics", () => {
  const fd = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };

  it("builds the viewport from two integers and a ratio", () =>
    expect(readDiagnostics(fd({ width: "1061", height: "1084", ratio: "2" })).viewport).toBe("1061×1084 @2x"));
  it("rounds an odd ratio to two places", () =>
    expect(readDiagnostics(fd({ width: "412", height: "915", ratio: "1.3333333" })).viewport).toBe("412×915 @1.33x"));
  it.each([
    ["0", "900", "1"],
    ["1440", "10001", "1"],
    ["1440", "900", "99"],
    ["14.5", "900", "1"],
    ["1440", "900", "0.4"],
  ])("drops a viewport outside its rule: %s×%s @%s", (width, height, ratio) =>
    expect(readDiagnostics(fd({ width, height, ratio })).viewport).toBeNull());
  it("keeps light and dark and nothing else", () => {
    expect(readDiagnostics(fd({ theme: "dark" })).theme).toBe("dark");
    expect(readDiagnostics(fd({ theme: "sepia" })).theme).toBeNull();
  });
  it("cuts a long user agent to 300 and drops one with a control character", () => {
    expect(readDiagnostics(fd({ userAgent: "x".repeat(400) })).userAgent).toHaveLength(300);
    expect(readDiagnostics(fd({ userAgent: "Mozilla\u0000" })).userAgent).toBeNull();
  });
  it("keeps marks 0–500 as an integer", () => {
    expect(readDiagnostics(fd({ marks: "0" })).marks).toBe(0);
    expect(readDiagnostics(fd({ marks: "500" })).marks).toBe(500);
    expect(readDiagnostics(fd({ marks: "501" })).marks).toBeNull();
    expect(readDiagnostics(fd({ marks: "2.5" })).marks).toBeNull();
  });
  it("is all null for an empty form", () =>
    expect(readDiagnostics(new FormData())).toEqual({ viewport: null, theme: null, userAgent: null, marks: null }));
});

describe("shortBuild", () => {
  it("is the first seven characters of a commit hash", () =>
    expect(shortBuild("F249B1F0c2d4e")).toBe("f249b1f"));
  it.each([undefined, "", "main", "f249b1"])("is null for %s", (raw) => expect(shortBuild(raw)).toBeNull());
});

describe("summarizeUserAgent", () => {
  it.each(UA_CASES)("reads %s", (_name, ua, expected) => expect(summarizeUserAgent(ua)).toBe(expected));
  it("is null for a string it knows nothing about", () => expect(summarizeUserAgent("curl/8.4.0")).toBeNull());
});

describe("diagnosticsLine", () => {
  it("joins what is there, in order", () =>
    expect(
      diagnosticsLine({ userAgent: MAC_CHROME_141, theme: "dark", viewport: "1061×1084 @2x", marks: 2, build: "f249b1f" })
    ).toBe("Chrome 141 on macOS · dark · 1061×1084 @2x · 2 marks · build f249b1f"));
  it("says 1 mark, and leaves out 0 marks", () => {
    expect(diagnosticsLine({ userAgent: null, theme: null, viewport: null, marks: 1, build: null })).toBe("1 mark");
    expect(diagnosticsLine({ userAgent: null, theme: "light", viewport: null, marks: 0, build: null })).toBe("light");
  });
  it("is null when nothing is there", () =>
    expect(diagnosticsLine({ userAgent: null, theme: null, viewport: null, marks: null, build: null })).toBeNull());
});

describe("reportPagePath", () => {
  it("sends the page", () => expect(reportPagePath("/students/abc")).toBe("/students/abc"));
  it.each(["/bugs", "/bugs/new", "/bugs/triage"])("sends nothing from %s", (p) =>
    expect(reportPagePath(p)).toBeNull());
});
