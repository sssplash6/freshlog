import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";

import type { User } from "@/generated/prisma/client";
import { toDateInputValue } from "@/lib/format";

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
  return !Number.isNaN(d.getTime()) && toDateInputValue(d) === day;
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

const day = toDateInputValue;

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
