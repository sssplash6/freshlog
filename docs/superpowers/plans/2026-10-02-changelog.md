# Changelog ("What's new") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/changelog` page rendered from `CHANGELOG.md`, with a per-user "unseen" dot on the account button and a "What's new" row in the account menu.

**Architecture:** A pure parser (`src/lib/changelog.ts`) turns the markdown file into entries; one nullable column `User.changelogSeenAt` records when someone last looked; a tiny client component writes it through a server action after the page mounts. The shell computes the dot from the cached file read plus the `User` it already has.

**Tech Stack:** Next.js (custom version — read `node_modules/next/dist/docs/` if an API surprises you), Prisma + SQLite, Vitest, Tailwind tokens.

**Spec:** `docs/superpowers/specs/2026-10-02-changelog-design.md`

## Global Constraints

- Every page function calls its own gate (`requireUser()`) on its first line, before any read (AGENTS.md, "Gate every page").
- `CHANGELOG.md` format: `## YYYY-MM-DD`, then `### New` / `### Fixed`, then plain-text bullets. No markdown library.
- A malformed block is skipped, never thrown.
- The "seen" comparison is by UTC calendar day: unseen when `entry.date > (changelogSeenAt ?? createdAt)` as `YYYY-MM-DD`.
- The dot is brand blue, never red; no count on any rail item.
- `npm run lint` runs `scripts/check-copy.mjs` — banned phrases include "appears here" and "newest first". Do not use them in UI copy.
- Test files are type-checked by the production build; keep them type-correct.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Only the last commit (Task 5) makes the feature reachable from the UI, so only it adds a `CHANGELOG.md` entry about it. Task 2's backfill is the file's first content.

## Review Focus

- `CHANGELOG.md` missing or unreadable: the page shows its empty state and the shell shows no dot (Task 2 pins `loadChangelog` on a missing path → `[]`).
- Windows line endings (`\r\n`) in the file parse the same as `\n` (Task 2).
- A bullet containing HTML (`<script>…`) is kept as literal text; React escapes it on render (Task 2).
- Someone who opened the page this morning and a second entry lands the same day: no dot until tomorrow — the accepted edge, pinned so nobody "fixes" it by accident (Task 2).
- A signed-out or garbage-cookie request never reaches the file read (Task 4).

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261002090000_changelog_seen/migration.sql` | `User.changelogSeenAt` |
| `src/lib/changelog.ts` | parse, read, and the unseen rule. Pure except `readChangelog`/`loadChangelog` |
| `src/lib/changelog.test.ts` | parser, rule, and a guard over the real `CHANGELOG.md` |
| `CHANGELOG.md` | the content users read |
| `src/lib/actions/changelog.ts` (+ `.test.ts`) | `markChangelogSeen` server action |
| `src/app/changelog/{layout,loading,page}.tsx`, `seen.tsx`, `page.test.ts` | the page |
| `src/components/app-shell.tsx` | dot + menu row |

---

### Task 1: Schema column

**Files:**
- Modify: `prisma/schema.prisma` (model `User`, after `digestSentAt`)
- Create: `prisma/migrations/20261002090000_changelog_seen/migration.sql`

**Interfaces:**
- Produces: `User.changelogSeenAt: Date | null` on the generated Prisma `User` type.

- [ ] **Step 1: Add the column to the schema**

In `model User`, directly after the `digestSentAt DateTime?` line, add:

```prisma
  // The last time this person opened /changelog. The dot on the account button
  // is "the newest entry is dated after this" — or after createdAt, for someone
  // who has never opened it, so a new user is not shown history that predates
  // them. A day, not an entry id: see docs/superpowers/specs/2026-10-02-changelog-design.md.
  changelogSeenAt DateTime?
```

- [ ] **Step 2: Write the migration**

```sql
-- When somebody last opened /changelog. Null for everyone until they do.

ALTER TABLE "User" ADD COLUMN "changelogSeenAt" DATETIME;
```

- [ ] **Step 3: Regenerate the client and apply the migration**

Run: `npx prisma generate && npx prisma migrate deploy && npx prisma migrate status`
Expected: the new migration applied; status says "Database schema is up to date!".

- [ ] **Step 4: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add prisma/schema.prisma prisma/migrations/20261002090000_changelog_seen
git commit -m "Record when each person last opened the changelog

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Parser, unseen rule, and the first entries

**Files:**
- Create: `src/lib/changelog.ts`, `src/lib/changelog.test.ts`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `User.changelogSeenAt` (Task 1).
- Produces:
  - `type ChangelogEntry = { date: string; new: string[]; fixed: string[] }`
  - `parseChangelog(text: string): ChangelogEntry[]` — newest first
  - `loadChangelog(file: string): Promise<ChangelogEntry[]>` — `[]` on any read failure
  - `readChangelog(): Promise<ChangelogEntry[]>` — `cache()`d, reads `<cwd>/CHANGELOG.md`
  - `type SeenFields = Pick<User, "changelogSeenAt" | "createdAt">`
  - `isUnseen(entry: ChangelogEntry, user: SeenFields): boolean`
  - `hasUnseenChangelog(entries: ChangelogEntry[], user: SeenFields): boolean`

- [ ] **Step 1: Write the failing tests**

`src/lib/changelog.test.ts`:

```ts
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
        "- orphan above any section is fine after this",
        "",
      ].join("\n")
    );
    expect(entries).toEqual([
      { date: "2026-02-02", new: ["kept", "orphan above any section is fine after this"], fixed: [] },
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/changelog.test.ts`
Expected: FAIL — cannot resolve `@/lib/changelog` (and `CHANGELOG.md` missing).

- [ ] **Step 3: Write the parser module**

`src/lib/changelog.ts`:

```ts
import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";

import type { User } from "@/generated/prisma/client";

/**
 * What users read at /changelog.
 *
 * The source is `CHANGELOG.md` at the repo root, written by whoever commits
 * (AGENTS.md, "Every commit writes its changelog entry") and shipped with the
 * code, so an entry is live exactly when its change is. This module turns that
 * file into entries and answers one question about them: has this person seen
 * the newest one?
 *
 * The parser SKIPS what it cannot read rather than throwing — a typo in a
 * markdown file must never take a page down. The cost is that a typo is silent,
 * which is why `changelog.test.ts` parses the real file and counts what was
 * dropped.
 */
export type ChangelogEntry = {
  /** `YYYY-MM-DD`. */
  date: string;
  new: string[];
  fixed: string[];
};

const DATE_HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/;
const SECTION_HEADING = /^###\s+(New|Fixed)\s*$/;
const BULLET = /^[-*]\s+(.*\S)\s*$/;

/** `2026-02-31` matches the shape and is not a day. */
function isRealDay(day: string): boolean {
  const d = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

export function parseChangelog(text: string): ChangelogEntry[] {
  const byDate = new Map<string, ChangelogEntry>();
  let entry: ChangelogEntry | null = null;
  let list: string[] | null = null;
  // The last line was a bullet, so an indented line after it continues it.
  let open = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();

    if (/^##(?!#)/.test(line)) {
      const day = DATE_HEADING.exec(line)?.[1];
      if (day && isRealDay(day)) {
        entry = byDate.get(day) ?? { date: day, new: [], fixed: [] };
        byDate.set(day, entry);
      } else {
        entry = null;
      }
      list = null;
      open = false;
      continue;
    }

    if (/^###(?!#)/.test(line)) {
      const section = SECTION_HEADING.exec(line)?.[1];
      list = entry && section ? (section === "New" ? entry.new : entry.fixed) : null;
      open = false;
      continue;
    }

    if (/^#\s/.test(line)) {
      entry = null;
      list = null;
      open = false;
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet && list) {
      list.push(bullet[1]);
      open = true;
    } else if (open && list && /^\s+\S/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`;
    } else {
      open = false;
    }
  }

  return [...byDate.values()]
    .filter((e) => e.new.length + e.fixed.length > 0)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** `[]` for any failure: a missing file is an empty changelog, not an outage. */
export async function loadChangelog(file: string): Promise<ChangelogEntry[]> {
  try {
    return parseChangelog(await readFile(file, "utf8"));
  } catch {
    return [];
  }
}

/** Once per request: the shell and the page both ask. */
export const readChangelog = cache(() =>
  loadChangelog(path.join(process.cwd(), "CHANGELOG.md"))
);

export type SeenFields = Pick<User, "changelogSeenAt" | "createdAt">;

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * By DAY, in UTC, against the last visit — or against `createdAt` for somebody
 * who has never opened the page, so a new user is not handed history that
 * predates them. Someone who looked this morning will not be told about a
 * second entry dated today until tomorrow; that is the price of not storing
 * per-entry state, and `changelog.test.ts` pins it as intended.
 */
export function isUnseen(entry: ChangelogEntry, user: SeenFields): boolean {
  return entry.date > day(user.changelogSeenAt ?? user.createdAt);
}

export function hasUnseenChangelog(entries: ChangelogEntry[], user: SeenFields): boolean {
  return entries.some((e) => isUnseen(e, user));
}
```

- [ ] **Step 4: Write `CHANGELOG.md`**

First confirm the dates against history: `git log --format='%ad %s' --date=short -20`. Use the dates below if they match; correct them if they do not.

```markdown
# Changelog

What we have added and fixed, newest first. Each commit that changes what you see or can do adds a line here.

## 2026-09-30

### New
- Moving a student to another program now carries their unused hours across, so nothing they were owed is lost in the move.
- A student who is visiting another program on an exchange can no longer be moved or unenrolled until the exchange ends. Returning them is the way out.

### Fixed
- Voiding a session now really lets you remove that mentor's hours. Before, voided sessions still counted and the removal stayed blocked.
- The grant menu on a student who has time in two programs was cut off the edge of the screen. It is reachable again, and each program's name now sits under the mentor.

## 2026-09-29

### New
- A program can set standard hours: every new student who joins gets a set number of hours to use within a set number of days, with no one granting them by hand.
- Program admins and mentors can be given access to just one program, with a screen for managing who has it.
- Opening a student from a program keeps you in that program, with a path back.

### Fixed
- The status labels on a student's task rows are lined up with the text beside them.
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/changelog.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/changelog.ts src/lib/changelog.test.ts CHANGELOG.md
git commit -m "Parse CHANGELOG.md, and say whether someone has seen its newest entry

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The mark-as-seen action

**Files:**
- Create: `src/lib/actions/changelog.ts`, `src/lib/actions/changelog.test.ts`
- Modify: `docs/superpowers/specs/2026-10-02-changelog-design.md` (the "Marking seen" bullet)

**Interfaces:**
- Consumes: `User.changelogSeenAt` (Task 1).
- Produces: `markChangelogSeen(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`src/lib/actions/changelog.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, mentor } from "@/test/db";

const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { markChangelogSeen } = await import("@/lib/actions/changelog");

const seen = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id } })).changelogSeenAt;

describe("markChangelogSeen", () => {
  it("stamps the caller's own row and nobody else's", async () => {
    const me = await mentor("Me");
    const other = await admin("Somebody Else");
    actor.value = me;

    const before = Date.now();
    await markChangelogSeen();

    const stamp = await seen(me.id);
    expect(stamp).not.toBeNull();
    expect(stamp!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(stamp!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(await seen(other.id)).toBeNull();
  });

  it("does nothing when nobody is signed in", async () => {
    const me = await mentor("Me");
    actor.value = null;

    await markChangelogSeen();

    expect(await seen(me.id)).toBeNull();
  });

  it("is safe to run twice", async () => {
    const me = await mentor("Me");
    actor.value = me;

    await markChangelogSeen();
    await markChangelogSeen();

    expect(await seen(me.id)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/actions/changelog.test.ts`
Expected: FAIL — cannot resolve `@/lib/actions/changelog`.

- [ ] **Step 3: Write the action**

`src/lib/actions/changelog.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

/**
 * "I have read what's new." Called by the changelog page after it mounts —
 * never during render, and never by a link prefetch — so the dot clears only
 * for somebody who actually opened the page.
 *
 * Quiet when signed out, like `markAllNotificationsRead`: the page is already
 * gated, and a stray call has nothing to write.
 */
export async function markChangelogSeen(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  await prisma.user.update({
    where: { id: user.id },
    data: { changelogSeenAt: new Date() },
  });

  revalidatePath("/", "layout");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/actions/changelog.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Align the spec with the repo's action convention**

In `docs/superpowers/specs/2026-10-02-changelog-design.md`, replace "The action (`src/app/changelog/actions.ts`) calls `requireUser()`, sets `changelogSeenAt = now`, and revalidates the shell." with "The action (`src/lib/actions/changelog.ts`) reads the current user the way the other actions do, returns quietly if there is none, sets `changelogSeenAt = now`, and revalidates the shell."

- [ ] **Step 6: Commit**

```bash
git add src/lib/actions/changelog.ts src/lib/actions/changelog.test.ts docs/superpowers/specs/2026-10-02-changelog-design.md
git commit -m "Add the action that records a visit to the changelog

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The `/changelog` page

**Files:**
- Create: `src/app/changelog/layout.tsx`, `loading.tsx`, `page.tsx`, `seen.tsx`, `page.test.ts`

**Interfaces:**
- Consumes: `readChangelog`, `isUnseen`, `hasUnseenChangelog` (Task 2); `markChangelogSeen` (Task 3).
- Produces: route `/changelog`; `MarkChangelogSeen` and `FreshChip` client components in `seen.tsx`.

- [ ] **Step 1: Write the failing page test**

`src/app/changelog/page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const session = vi.hoisted(() => ({ signedIn: true }));

vi.mock("@/lib/dal", () => ({
  requireUser: async () => {
    calls.push("gate");
    if (!session.signedIn) throw new Error("redirect:/login");
    return { id: "u1", createdAt: new Date("2026-01-01T00:00:00Z"), changelogSeenAt: null };
  },
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/changelog", async (original) => ({
  ...(await original<typeof import("@/lib/changelog")>()),
  readChangelog: async () => {
    calls.push("read");
    return [{ date: "2026-10-02", new: ["Something new"], fixed: [] }];
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { default: ChangelogPage } = await import("@/app/changelog/page");

beforeEach(() => {
  calls.length = 0;
  session.signedIn = true;
});

describe("/changelog", () => {
  it("gates before it reads anything", async () => {
    await ChangelogPage();
    expect(calls).toEqual(["gate", "read"]);
  });

  it("never reaches the file for a signed-out request", async () => {
    session.signedIn = false;
    await expect(ChangelogPage()).rejects.toThrow("redirect:/login");
    expect(calls).toEqual(["gate"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/changelog/page.test.ts`
Expected: FAIL — cannot resolve `@/app/changelog/page`.

- [ ] **Step 3: Write the client components**

`src/app/changelog/seen.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

import { StatusChip } from "@/components/ui/status-chip";
import { markChangelogSeen } from "@/lib/actions/changelog";

/**
 * Records the visit once the page is on screen. In an effect, not in the page
 * function, so a prefetch of the link never clears the dot and the database is
 * not written during render.
 */
export function MarkChangelogSeen() {
  useEffect(() => {
    void markChangelogSeen();
  }, []);
  return null;
}

/**
 * The "New" marker, decided on the FIRST render and kept.
 *
 * Marking the page seen revalidates the layout, which re-renders this page with
 * `fresh` now false for every entry. A chip that followed the prop would vanish
 * a moment after the reader arrived — before they could tell which entries were
 * the new ones. State survives that refresh; the prop does not.
 */
export function FreshChip({ fresh }: { fresh: boolean }) {
  const [wasFresh] = useState(fresh);
  return wasFresh ? <StatusChip severity="neutral">New</StatusChip> : null;
}
```

- [ ] **Step 4: Write the layout, loading and page**

`src/app/changelog/layout.tsx`:

```tsx
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/dal";

// Authenticated, per-user, and reads the database on every request.
export const dynamic = "force-dynamic";

export default async function ChangelogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
```

`src/app/changelog/loading.tsx`:

```tsx
import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return <PageSkeleton />;
}
```

`src/app/changelog/page.tsx`:

```tsx
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { hasUnseenChangelog, isUnseen, readChangelog, type ChangelogEntry } from "@/lib/changelog";
import { requireUser } from "@/lib/dal";
import { formatDate } from "@/lib/format";

import { FreshChip, MarkChangelogSeen } from "./seen";

/**
 * What changed, written for the person using the product.
 *
 * Every role reads it and nothing on it is scoped — it is not about a student
 * or a program — but the gate still goes on the first line: the layout's
 * redirect does not stop this function running (AGENTS.md, "Gate every page").
 */
export default async function ChangelogPage() {
  const user = await requireUser();
  const entries = await readChangelog();

  return (
    <div className="space-y-8">
      {hasUnseenChangelog(entries, user) && <MarkChangelogSeen />}

      <PageTitle title="What's new" subtitle="What we have added and fixed." />

      {entries.length === 0 ? (
        <EmptyState title="No updates yet">Changes are posted here as they ship.</EmptyState>
      ) : (
        entries.map((entry) => (
          <Section
            key={entry.date}
            title={
              <>
                {formatDate(new Date(`${entry.date}T00:00:00.000Z`))}{" "}
                <FreshChip fresh={isUnseen(entry, user)} />
              </>
            }
          >
            <div className="space-y-4 px-1">
              <Items label="New" items={entry.new} />
              <Items label="Fixed" items={entry.fixed} />
            </div>
          </Section>
        ))
      )}
    </div>
  );
}

function Items({ label, items }: { label: string; items: ChangelogEntry["new"] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-[0.8125rem] font-semibold text-muted-fg">{label}</h3>
      <ul className="mt-1.5 list-disc space-y-1.5 pl-5 text-[0.9375rem] text-ink">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
```

Note: "Changes are posted here as they ship." avoids the banned "appears here"/"shows up here"/"lands here" patterns. If `npm run lint` still objects, reword rather than disabling the rule.

- [ ] **Step 5: Run to verify the page test passes**

Run: `npx vitest run src/app/changelog/page.test.ts`
Expected: PASS, 2 tests. If importing a UI component fails under node, mock that component in the test (as `@/lib/dal` is) rather than changing the component.

- [ ] **Step 6: Lint, type-check, commit**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean. Fix any colour/spacing/copy-lint complaints on the new markup using tokens already used elsewhere.

```bash
git add src/app/changelog
git commit -m "Add the /changelog page

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The dot and the menu row, with this feature's own entry

**Files:**
- Modify: `src/components/app-shell.tsx` (imports; `AccountMenu`; `StaffShell`; `StudentShell`; `AppShell`)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `readChangelog`, `hasUnseenChangelog` (Task 2); route `/changelog` (Task 4).

- [ ] **Step 1: Import the helpers**

In `app-shell.tsx`, beside the other `@/lib/...` imports:

```ts
import { hasUnseenChangelog, readChangelog } from "@/lib/changelog";
```

- [ ] **Step 2: Add a `whatsNew` prop to `AccountMenu`**

Change its props to `{ user, lens, mentorProfile, whatsNew }` with `/** Something in the changelog this person has not opened. */ whatsNew: boolean;` in the type.

Set the trigger's label: `label={whatsNew ? "Account (new updates)" : "Account"}`.

Wrap the avatar-or-initial in a positioning span and add the dot — replace the `{user.avatarUpdatedAt ? (…) : (…)}` expression inside `trigger` with:

```tsx
<span className="relative shrink-0">
  {user.avatarUpdatedAt ? (
    <Avatar person={user} className="h-8 w-8 shrink-0" />
  ) : (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand"
    >
      {initial}
    </span>
  )}
  {whatsNew && (
    <span
      aria-hidden="true"
      className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-surface"
    />
  )}
</span>
```

(Keep the existing explanatory comment about the brand-soft initial above the inner span.)

Add the menu row directly after the Settings `<Link>`:

```tsx
<Link
  href="/changelog"
  transitionTypes={["nav-forward"]}
  className="flex min-h-11 items-center justify-between rounded-lg px-3 text-[0.9375rem] text-ink transition-colors hover:bg-fill"
>
  {"What's new"}
  {whatsNew && (
    <span
      role="img"
      aria-label="Unread updates"
      className="h-2 w-2 rounded-full bg-brand"
    />
  )}
</Link>
```

- [ ] **Step 3: Thread the prop through both shells**

Add `whatsNew: boolean` to the props type of `StaffShell` and `StudentShell`. In `StaffShell`'s `account` element pass `whatsNew={whatsNew}`; in `StudentShell` use `<AccountMenu user={user} lens={null} mentorProfile={false} whatsNew={whatsNew} />`.

- [ ] **Step 4: Compute it once in `AppShell`**

Extend the existing `Promise.all` with a fourth element and destructure it:

```ts
const [profile, unread, recent, changelog] = await Promise.all([
  profileOf(user),
  prisma.notification.count({ where: { userId: user.id, read: false } }),
  prisma.notification.findMany({ /* unchanged */ }),
  readChangelog(),
]);
const whatsNew = hasUnseenChangelog(changelog, user);
```

Pass `whatsNew={whatsNew}` to both `<StudentShell …>` and `<StaffShell …>`.

- [ ] **Step 5: Add this feature's entry**

At the top of `CHANGELOG.md`, above `## 2026-09-30`, add (date = today's date at commit time; use `date +%F`):

```markdown
## 2026-10-02

### New
- There is now a "What's new" page in the account menu listing what we have added and fixed. A blue dot on your account button tells you when there is something you have not read.
```

- [ ] **Step 6: Lint, type-check, test, build**

Run: `npm run lint && npx tsc --noEmit && npm test && npm run build`
Expected: all clean; full suite passes (the pre-existing 445 plus the new tests).

- [ ] **Step 7: Verify in the running app**

Use the `verify` skill (build, run, session-cookie login). Check, as a student, a mentor and an admin:
1. The account button shows a blue dot; the menu has "What's new" with a dot.
2. Opening `/changelog` lists the entries, the newest marked "New" — and the markers are still there a few seconds later.
3. Navigating elsewhere: the dot is gone. Reloading `/changelog`: no "New" markers.
4. Signed out, `/changelog` redirects to `/login`.
5. At 390px width the dot sits on the avatar and the menu row does not wrap.

- [ ] **Step 8: Commit**

```bash
git add src/components/app-shell.tsx CHANGELOG.md
git commit -m "Show a dot on the account button when the changelog has something new

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
