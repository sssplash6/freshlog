#!/usr/bin/env node
/**
 * Fail on a spacing step that is not on the scale.
 *
 * The scale is three values and it lives in `components/ui/section.tsx`:
 *
 *   space-y-4   between top-level blocks of a page
 *   py-2.5      a section's HEADER band
 *   py-2        everything INSIDE a section — a body, a table cell
 *   py-3        a LIST ROW (September 2026, iOS pass): 44px-plus rows are what
 *               makes a grouped list read as calm rather than as a ledger, and
 *               py-2 rows of 36px were the densest thing on every page
 *
 * Before it, the page rhythm was `space-y-4`, `-5`, `-6` and `-8` across
 * seventeen pages, and the vertical padding inside a card was 2, 2.5, 3, 3.5,
 * 4 and 5 chosen per call site. No two pages scrolled the same, and each one
 * scrolled further than it needed to — on the phone this product is read on.
 *
 * Neither of those was a decision anybody made. They are what happens when
 * every new screen picks a number that looks right on its own, which is why
 * this is a guard and not a note in DESIGN.md: the drift comes back one
 * plausible `py-4` at a time.
 *
 * WHAT IS EXEMPT, and it is a short list. The page shell's own outer padding
 * (it holds the whole app off the viewport edge, not one card off another),
 * an `EmptyState` (its job is to be a large quiet area), and the signed-out
 * pages, which are one centred card on an empty screen and read as posters.
 *
 *   node scripts/check-spacing.mjs [--warn]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const WARN = process.argv.includes("--warn");
const SKIP_DIRS = new Set(["generated", "node_modules"]);

/**
 * Files allowed to spend more air, per rule and never file-wide — the lesson
 * `check-copy.mjs` records at its own allowlist.
 */
const RULES = [
  {
    re: /\bspace-y-(?:5|6|7|8|9|10|11|12)\b/,
    why: "page rhythm is space-y-4 — see the scale in components/ui/section.tsx",
    allow: [
      // One centred card on an empty screen; there is nothing to be dense next to.
      "src/app/login/page.tsx",
      "src/app/onboarding/page.tsx",
      "src/components/public-shell.tsx",
      "src/app/error.tsx",
      "src/app/global-error.tsx",
      "src/components/error-state.tsx",
      "src/components/ui/empty-state.tsx",
    ],
  },
  {
    re: /\bpy-(?:3\.5|4|5|6|7|8|9|10|11|12|14|16|20|24)\b/,
    why: "vertical padding inside a card is py-2, py-3 for a list row (py-2.5 for a section header)",
    allow: [
      // The shell holds the app off the viewport edge — not a card off a card.
      "src/components/app-shell.tsx",
      "src/components/public-shell.tsx",
      "src/components/sidebar.tsx",
      "src/components/tab-bar.tsx",
      // Deliberately large quiet areas.
      "src/components/ui/empty-state.tsx",
      "src/components/error-state.tsx",
      "src/app/error.tsx",
      "src/app/global-error.tsx",
      "src/app/loading.tsx",
      "src/app/login/page.tsx",
      "src/app/page.tsx",
      "src/app/unsubscribe/page.tsx",
      // Email HTML is inline-styled for clients that ignore a stylesheet; its
      // padding is not this app's layout at all.
      "src/lib/email/layout.ts",
      "src/lib/email/welcome.ts",
    ],
  },
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(path, out);
    } else if (/\.(ts|tsx|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

/** A comment naming a banned class is not a use of it. */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

const found = [];
for (const path of walk(SRC)) {
  const rel = relative(ROOT, path);
  const lines = withoutComments(readFileSync(path, "utf8")).split("\n");
  lines.forEach((line, i) => {
    // Only inside a class string: `py-4` in prose or an identifier is not a
    // utility, and `sm:py-2` is the same step at a breakpoint, not a fourth.
    for (const m of line.matchAll(
      /class(?:Name)?=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})|"([^"]*\b(?:py|space-y)-[^"]*)"/g
    )) {
      const classes = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
      for (const { re, why, allow } of RULES) {
        if (allow.includes(rel)) continue;
        const hit = classes.match(re);
        if (hit) {
          found.push({ where: `${rel}:${i + 1}`, found: hit[0], why });
        }
      }
    }
  });
}

for (const { where, found: cls, why } of found) {
  console.error(`  ${where}  ${cls} — ${why}`);
}
console.log(
  found.length === 0
    ? "check-spacing: every step is on the scale"
    : `check-spacing: ${found.length} off-scale step(s)`
);
if (found.length > 0 && !WARN) process.exit(1);
