#!/usr/bin/env node
/**
 * Fail on a type size, corner or shadow that is not on the scale.
 *
 * The scale lives in `src/app/globals.css` (October 2026): nine type steps,
 * each a size with its line-height attached (`text-caption` … `text-lead`),
 * four corner rungs from 8px up, and four shadows that each mean a distance.
 * An audit that month measured what the app actually rendered without a guard:
 * SIXTEEN font sizes, 13px text at five line-heights, nine corner radii and
 * three shadows nobody chose. Every one of them was a plausible number at its
 * own call site — which is why this is a script and not a sentence in
 * DESIGN.md, the same lesson `check-spacing.mjs` records.
 *
 * Part of `npm run lint` since the October 2026 codemod moved every
 * `text-[0.8125rem]`-style size onto a token (`text-[0.75rem]` → `text-caption`,
 * `text-[0.8125rem]` → `text-xs`, `text-[0.9375rem]` → `text-body`,
 * `text-[1.0625rem]` → `text-title`, …).
 *
 *   node scripts/check-type.mjs [--warn]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const WARN = process.argv.includes("--warn");
const SKIP_DIRS = new Set(["generated", "node_modules"]);

const RULES = [
  {
    // text-[0.8125rem], text-[13px], sm:text-[2rem] — a size, not a colour
    // (`text-[var(--x)]` and `text-[color:…]` are not sizes).
    re: /\b(?:[a-z0-9-]+:)*text-\[(?:\d*\.?\d+)(?:rem|px|em)\]/g,
    why: "use a type token: text-caption/xs/sm/body/title/figure-md/figure-lg/display/lead",
  },
  {
    // Bare `rounded` (4px) and `rounded-sm`: under the 8px floor.
    re: /(?<![\w-])(?:[a-z0-9-]+:)*rounded(?:-sm)?(?![\w-])/g,
    why: "corners start at rounded-md (8px) — see the radius scale in globals.css",
  },
  {
    re: /\b(?:[a-z0-9-]+:)*shadow-(?:md|2xl|xs|\[[^\]]*\])/g,
    why: "shadows are sm (resting), control, lg (floating) and xl (modal)",
  },
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(path, out);
    } else if (/\.tsx$/.test(entry)) {
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
  withoutComments(readFileSync(path, "utf8"))
    .split("\n")
    .forEach((line, i) => {
      // Only inside string literals: class names live in strings.
      for (const str of line.matchAll(/"([^"]*)"|`([^`]*)`|'([^']*)'/g)) {
        const text = str[1] ?? str[2] ?? str[3] ?? "";
        for (const { re, why } of RULES) {
          for (const hit of text.matchAll(re)) {
            found.push({ where: `${rel}:${i + 1}`, cls: hit[0], why });
          }
        }
      }
    });
}

for (const { where, cls, why } of found) console.error(`  ${where}  ${cls} — ${why}`);
const byClass = new Map();
for (const { cls } of found) byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
console.log(
  found.length === 0
    ? "check-type: every size, corner and shadow is on the scale"
    : `check-type: ${found.length} off-scale class(es), ${byClass.size} distinct — most common: ` +
        [...byClass].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, n]) => `${c} ×${n}`).join(", ")
);
if (found.length > 0 && !WARN) process.exit(1);
