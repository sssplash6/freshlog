#!/usr/bin/env node
/**
 * Fail on the copy habits the reorganisation is removing, and on the one CSS
 * mistake that makes long text render wrong.
 *
 * Two rules, both learned from reading every string in the app:
 *
 * BANNED PHRASES — fourteen empty states ended "appears here", "Talk to your
 * program contact" was printed five times with no name or link, and "Hrs left"
 * broke the unit rule DESIGN.md sets. Each is a habit, not a typo: it comes
 * back the moment someone writes a new empty state from memory.
 *
 * TRUNCATE WITHOUT A WIDTH — `truncate` on a flex child does nothing unless
 * the child can shrink below its content, which needs `min-w-0` (or a fixed
 * `max-w-`). This is why names in table cells were "truncated" and still blew
 * the column open. A className with one and not the other is the bug.
 *
 *   node scripts/check-copy.mjs [--warn]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const WARN = process.argv.includes("--warn");
const SKIP_DIRS = new Set(["generated", "node_modules", "test"]);

const BANNED = [
  { re: /appears? here|shows? up here|lands? here/i, why: "empty-state boilerplate — say what is absent and why, not where it will appear" },
  { re: /newest first/i, why: "the order is visible; do not state it" },
  { re: /\bHrs\b/, why: "a figure carries its own unit — use formatDuration" },
  { re: /still to deliver/i, why: "vocabulary drift — one word per quantity" },
  // The ledger's three headline words are Total, Completed and Remaining, and
  // they are the same for every reader (REDESIGN.md §5.7.3). Each spelling
  // below was in the app at once, so a student's "Left" and an admin's
  // "Remaining" were the same number under two names. Only LABEL positions are
  // matched — a `label=`/`title=` prop, a `{ label: "…" }` column, a `<dt>` —
  // because "left" is also a CSS word and "delivered" is fine in prose about
  // sessions.
  {
    re: /(?:label|title|heading|suffix)\s*[:=]\s*\{?["'`][^"'`]*\b(Allotted|Allocated|Delivered|Left)\b/,
    why: "the ledger says Total / Completed / Remaining, to every reader",
  },
  {
    re: /\b(time left|left with you|left to book|left across|no time left|Still yours|Hrs left)\b/i,
    why: "the ledger says Total / Completed / Remaining, to every reader",
  },
  { re: /Talk to your|program contact/i, why: "name the person or link them — see programContact()" },
  { re: /config\/app-config\.ts/, why: "never put a source path in user-facing copy" },
  {
    re: /\.toISOString\(\)\.slice/,
    why: "machine date in the UI — use formatDate",
    // An <input type="date"> value is required to be ISO by the HTML spec, so
    // the one module that owns that conversion is allowed to make it.
    allow: ["src/lib/format.ts"],
  },
  { re: /Nothing (yet|here)\b/i, why: "generic empty state — say what is empty" },
  {
    // A TRAILING arrow — nothing after it but the end of the text node — is a
    // link affordance drawn as a character: it cannot be tabbed to, screen
    // readers say "right arrow", and it was on five links whose real hover
    // colour was orange. An arrow BETWEEN two values ("2h 30m → 4h") is a
    // change, not a link, so it must keep working.
    re: /→\s*(["'<}]|$)/,
    why: "a trailing arrow is not a link — use ArrowLink or ExternalLink",
  },
];

/**
 * Exemptions are PER RULE, not per file.
 *
 * A file-wide allowlist looked equivalent and was not: exempting `format.ts`
 * from the ISO-date rule also exempted it from every other rule, so that one
 * file could quietly carry any banned phrase. Found by reintroducing one
 * deliberately and watching the guard pass.
 */

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(path, out);
        } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      // A test's strings are assertions ABOUT copy, not copy: `when.test.ts`
      // must be free to write an ISO date, since proving the day arithmetic is
      // the whole point of the file. The copy itself still lives in source and
      // is still checked there.
      out.push(path);
    }
  }
  return out;
}

/**
 * Strip line and block comments so a comment explaining a rule is not itself a
 * violation of it. Crude on purpose: a `//` inside a string literal (a URL)
 * only ever loses us a check, never invents one.
 */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

const phrase = [];
const truncate = [];

for (const path of walk(SRC)) {
  const rel = relative(ROOT, path);
  const lines = withoutComments(readFileSync(path, "utf8")).split("\n");
  lines.forEach((line, i) => {
    const where = `${rel}:${i + 1}`;
    for (const { re, why, allow } of BANNED) {
      if (allow?.includes(rel)) continue;
      const m = line.match(re);
      if (m) phrase.push({ where, found: m[0].trim(), why });
    }
    // Only look inside a className/class string, where `truncate` is a utility.
    for (const m of line.matchAll(/class(?:Name)?=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)) {
      const classes = m[1] ?? m[2] ?? m[3] ?? "";
      if (/\btruncate\b/.test(classes) && !/\bmin-w-0\b|\bmax-w-/.test(classes)) {
        truncate.push({ where, classes: classes.trim().slice(0, 70) });
      }
    }
  });
}

for (const { where, found, why } of phrase) {
  console.log(`  ${where}  "${found}" — ${why}`);
}
for (const { where, classes } of truncate) {
  console.log(`  ${where}  truncate without min-w-0 or max-w-: "${classes}"`);
}

const total = phrase.length + truncate.length;
if (total === 0) {
  console.log("check-copy: no banned phrases, no unanchored truncate");
  process.exit(0);
}
console.log(
  `\ncheck-copy: ${phrase.length} banned phrase(s), ${truncate.length} unanchored truncate(s)`
);
process.exit(WARN ? 0 : 1);
