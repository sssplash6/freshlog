import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  hasUnseenChangelog,
  isUnseen,
  loadChangelog,
  parseChangelog,
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

describe("loadChangelog", () => {
  it("reads the real file", async () => {
    const entries = await loadChangelog(path.join(process.cwd(), "CHANGELOG.md"));
    expect(entries.length).toBeGreaterThan(0);
  });

  it("returns an empty list when the file is missing", async () => {
    expect(await loadChangelog("/definitely/not/here/CHANGELOG.md")).toEqual([]);
  });
});

const entry = (date: string): ChangelogEntry => ({ date, new: ["x"], fixed: [] });
const person = (createdAt: string, seen: string | null) => ({
  createdAt: new Date(createdAt),
  changelogSeenAt: seen ? new Date(seen) : null,
});

describe("hasUnseenChangelog", () => {
  it("is false when there are no entries", () => {
    expect(hasUnseenChangelog([], person("2026-01-01T00:00:00Z", null))).toBe(false);
  });

  it("does not show a new person history that predates them", () => {
    const user = person("2026-09-01T10:00:00Z", null);
    expect(hasUnseenChangelog([entry("2026-08-15")], user)).toBe(false);
  });

  it("shows a new person an entry written after they joined", () => {
    const user = person("2026-09-01T10:00:00Z", null);
    expect(hasUnseenChangelog([entry("2026-09-02")], user)).toBe(true);
  });

  it("is false once they have opened the page since the newest entry", () => {
    const user = person("2026-01-01T00:00:00Z", "2026-10-03T08:00:00Z");
    expect(hasUnseenChangelog([entry("2026-10-02")], user)).toBe(false);
  });

  it("is true when an entry is dated after the last visit", () => {
    const user = person("2026-01-01T00:00:00Z", "2026-10-01T08:00:00Z");
    expect(hasUnseenChangelog([entry("2026-10-02"), entry("2026-09-20")], user)).toBe(true);
  });

  it("does not flag a same-day entry added after they looked (accepted edge)", () => {
    const user = person("2026-01-01T00:00:00Z", "2026-10-02T06:00:00Z");
    expect(hasUnseenChangelog([entry("2026-10-02")], user)).toBe(false);
  });
});

describe("isUnseen", () => {
  it("judges each entry on its own date", () => {
    const user = person("2026-01-01T00:00:00Z", "2026-09-25T12:00:00Z");
    expect(isUnseen(entry("2026-09-30"), user)).toBe(true);
    expect(isUnseen(entry("2026-09-20"), user)).toBe(false);
  });
});
