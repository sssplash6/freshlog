import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  hasUnseenChangelog,
  isUnseen,
  loadChangelog,
  parseChangelog,
  snapshotChangelog,
  splitItem,
  type ChangelogEntry,
} from "@/lib/changelog";

const FILE = `# Changelog

Intro text that is not an entry.

## 2026-09-30

### New
- Hours carry across a program move.
- A second new thing.

### Fixed
- Voiding a session unblocks removal.

## 2026-10-02

### New
- Standard hours.
`;

describe("parseChangelog", () => {
  it("reads dated entries with both sections, newest first", () => {
    const entries = parseChangelog(FILE);
    expect(entries.map((e) => e.date)).toEqual(["2026-10-02", "2026-09-30"]);
    expect(entries[1]).toEqual({
      date: "2026-09-30",
      new: ["Hours carry across a program move.", "A second new thing."],
      fixed: ["Voiding a session unblocks removal."],
    });
    expect(entries[0].fixed).toEqual([]);
  });

  it("sorts by date whatever order the file is in", () => {
    const entries = parseChangelog(
      "## 2026-01-01\n### New\n- a\n\n## 2026-03-01\n### New\n- c\n\n## 2026-02-01\n### Fixed\n- b\n"
    );
    expect(entries.map((e) => e.date)).toEqual(["2026-03-01", "2026-02-01", "2026-01-01"]);
  });

  it("merges two headings for the same day", () => {
    const entries = parseChangelog(
      "## 2026-01-01\n### New\n- a\n\n## 2026-01-01\n### New\n- b\n### Fixed\n- c\n"
    );
    expect(entries).toEqual([{ date: "2026-01-01", new: ["a", "b"], fixed: ["c"] }]);
  });

  it("joins a wrapped bullet into one line", () => {
    const entries = parseChangelog("## 2026-01-01\n### New\n- first half\n  second half\n- next\n");
    expect(entries[0].new).toEqual(["first half second half", "next"]);
  });

  it("accepts * bullets", () => {
    expect(parseChangelog("## 2026-01-01\n### New\n* starred\n")[0].new).toEqual(["starred"]);
  });

  it("skips a block it cannot read instead of throwing", () => {
    const entries = parseChangelog(
      [
        "## not a date",
        "### New",
        "- lost",
        "## 2026-13-45",
        "### New",
        "- also lost",
        "## 2026-02-02",
        "### Surprising",
        "- lost too",
        "### New",
        "- kept",
        "- kept as well",
        "",
      ].join("\n")
    );
    expect(entries).toEqual([
      { date: "2026-02-02", new: ["kept", "kept as well"], fixed: [] },
    ]);
  });

  it("drops a day that has no bullets", () => {
    expect(parseChangelog("## 2026-01-01\n### New\n")).toEqual([]);
  });

  it("returns nothing for an empty file", () => {
    expect(parseChangelog("")).toEqual([]);
  });

  it("reads Windows line endings", () => {
    const entries = parseChangelog("## 2026-01-01\r\n### Fixed\r\n- a\r\n- b\r\n");
    expect(entries).toEqual([{ date: "2026-01-01", new: [], fixed: ["a", "b"] }]);
  });

  it("keeps HTML as literal text — React escapes it on render", () => {
    const entries = parseChangelog("## 2026-01-01\n### New\n- <script>alert(1)</script> & <b>bold</b>\n");
    expect(entries[0].new).toEqual(["<script>alert(1)</script> & <b>bold</b>"]);
  });
});

describe("the repository's own CHANGELOG.md", () => {
  // The parser skips what it cannot read, which is right for a page and wrong
  // for the person writing the entry: a typo would vanish silently. This is
  // where it is caught instead.
  const text = readFileSync(path.join(process.cwd(), "CHANGELOG.md"), "utf8");

  it("has no heading or bullet the parser dropped", () => {
    const entries = parseChangelog(text);
    const dateHeadings = text.split("\n").filter((l) => /^##(?!#)/.test(l));
    const badHeadings = dateHeadings.filter((l) => !/^## \d{4}-\d{2}-\d{2}\s*$/.test(l));
    expect(badHeadings).toEqual([]);

    const days = new Set(dateHeadings.map((l) => l.slice(3).trim()));
    expect(entries.length).toBe(days.size);

    const bullets = text.split("\n").filter((l) => /^[-*]\s/.test(l)).length;
    const parsed = entries.reduce((n, e) => n + e.new.length + e.fixed.length, 0);
    expect(parsed).toBe(bullets);

    const sections = text.split("\n").filter((l) => /^###(?!#)/.test(l));
    expect(sections.filter((l) => !/^### (New|Fixed)\s*$/.test(l))).toEqual([]);
  });
});

describe("splitItem", () => {
  it("splits a bold headline from its detail", () => {
    expect(splitItem("**Filters apply.** Program and date now work.")).toEqual({
      headline: "Filters apply",
      detail: "Program and date now work.",
    });
  });

  it("leaves an item with no bold lead as plain text", () => {
    expect(splitItem("Just a sentence.")).toEqual({ headline: null, detail: "Just a sentence." });
  });
});

describe("every item in CHANGELOG.md", () => {
  it("has a headline and a detail short enough to skim", () => {
    const entries = parseChangelog(readFileSync(path.join(process.cwd(), "CHANGELOG.md"), "utf8"));
    for (const item of entries.flatMap((e) => [...e.new, ...e.fixed])) {
      const { headline, detail } = splitItem(item);
      expect(headline, item).not.toBeNull();
      expect(headline!.length, item).toBeLessThanOrEqual(48);
      expect(detail.length, item).toBeLessThanOrEqual(300);
    }
  });
});

describe("loadChangelog", () => {
  it("reads the real file", async () => {
    const entries = await loadChangelog(path.join(process.cwd(), "CHANGELOG.md"));
    expect(entries.length).toBeGreaterThan(0);
  });

  it("returns an empty list when the file is missing", async () => {
    expect(await loadChangelog("/definitely/not/here/CHANGELOG.md")).toEqual([]);
  });
});

const entry = (date: string, ...bullets: string[]): ChangelogEntry => ({
  date,
  new: bullets.length ? bullets : ["x"],
  fixed: [],
});
const person = (createdAt: string, seen: Record<string, number> | string | null = null) => ({
  createdAt: new Date(createdAt),
  changelogSeen: seen === null ? null : typeof seen === "string" ? seen : JSON.stringify(seen),
});

describe("hasUnseenChangelog", () => {
  it("is false when there are no entries", () => {
    expect(hasUnseenChangelog([], person("2026-01-01T00:00:00Z"))).toBe(false);
  });

  it("does not show a new person history that predates them", () => {
    expect(hasUnseenChangelog([entry("2026-08-15")], person("2026-09-01T10:00:00Z"))).toBe(false);
  });

  it("shows a new person an entry written after they joined", () => {
    expect(hasUnseenChangelog([entry("2026-09-02")], person("2026-09-01T10:00:00Z"))).toBe(true);
  });

  it("is false for somebody who has read everything there is", () => {
    const entries = [entry("2026-10-02", "a", "b"), entry("2026-09-20", "c")];
    const user = person("2026-01-01T00:00:00Z", JSON.parse(snapshotChangelog(entries)));
    expect(hasUnseenChangelog(entries, user)).toBe(false);
  });

  it("lights up for a bullet added to a day they had already read", () => {
    const before = [entry("2026-10-02", "a")];
    const user = person("2026-01-01T00:00:00Z", JSON.parse(snapshotChangelog(before)));
    const after = [entry("2026-10-02", "a", "added later the same day")];
    expect(hasUnseenChangelog(after, user)).toBe(true);
  });

  it("lights up for an entry dated before their last visit but deployed after it", () => {
    // Dates are commit days and deploys are manual: they opened the page after
    // the 10-04 deploy, and the 10-03 and 10-04 commits made since went live
    // on 10-07. Neither is "newer than the visit", and both are unread.
    const read = [entry("2026-10-02", "a")];
    const user = person("2026-01-01T00:00:00Z", JSON.parse(snapshotChangelog(read)));
    const now = [entry("2026-10-04", "d"), entry("2026-10-03", "c"), ...read];
    expect(hasUnseenChangelog(now, user)).toBe(true);
  });

  it("is cleared by a visit even when an entry is dated in the future", () => {
    const entries = [entry("2099-01-01", "dated tomorrow, UTC")];
    const user = person("2026-01-01T00:00:00Z", JSON.parse(snapshotChangelog(entries)));
    expect(hasUnseenChangelog(entries, user)).toBe(false);
  });

  it("falls back to the createdAt rule when the stored record is unreadable", () => {
    for (const junk of ["not json", "[1,2]", "null", "42"]) {
      const user = person("2026-09-01T10:00:00Z", junk);
      expect(hasUnseenChangelog([entry("2026-08-15")], user)).toBe(false);
      expect(hasUnseenChangelog([entry("2026-09-02")], user)).toBe(true);
    }
  });
});

describe("isUnseen", () => {
  it("judges each entry on what was read of that day", () => {
    const user = person("2026-01-01T00:00:00Z", { "2026-09-20": 1, "2026-09-30": 1 });
    expect(isUnseen(entry("2026-09-20"), user)).toBe(false);
    expect(isUnseen(entry("2026-09-30", "a", "b"), user)).toBe(true);
    expect(isUnseen(entry("2026-10-01"), user)).toBe(true);
  });
});

describe("snapshotChangelog", () => {
  it("records how many bullets each day had", () => {
    const entries: ChangelogEntry[] = [
      { date: "2026-10-02", new: ["a"], fixed: ["b", "c"] },
      entry("2026-09-30", "d"),
    ];
    expect(JSON.parse(snapshotChangelog(entries))).toEqual({ "2026-10-02": 3, "2026-09-30": 1 });
  });
});
