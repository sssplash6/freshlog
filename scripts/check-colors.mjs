#!/usr/bin/env node
/**
 * Fail when a raw Tailwind palette class appears in src/.
 *
 * Colour in this app is semantic: brand blue acts, orange means hours, amber
 * asks for attention, red means a problem, and three muted tones identify
 * people. That only holds if every one of those meanings has exactly one
 * token — so `text-red-700` (36 occurrences when this was written) has to
 * become `text-danger-ink`, and stay that way. Twelve hue families collapsing
 * to five is undone by one careless `bg-green-50`.
 *
 * Run as part of `npm run lint`. `--warn` reports and exits 0, which is how it
 * ships during the reorganisation; it becomes an error at the end of Phase 1,
 * once the last raw class is gone.
 *
 *   node scripts/check-colors.mjs [--warn]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const WARN = process.argv.includes("--warn");

/** Generated Prisma types are not ours to police. */
const SKIP_DIRS = new Set(["generated", "node_modules"]);

/**
 * Files allowed to carry raw colour. Only for colour that is NOT ours: the
 * Google mark on the sign-in button is Google's four brand hexes and must not
 * be re-tinted.
 */
const ALLOWLIST = new Set(["src/app/login/page.tsx"]);

const UTILITY = "text|bg|border|ring|stroke|fill|divide|outline|from|to|via|shadow|accent|caret|decoration|placeholder";
const PALETTE =
  "red|amber|green|emerald|yellow|blue|violet|purple|indigo|sky|cyan|teal|lime|orange|rose|pink|fuchsia|slate|gray|grey|zinc|neutral|stone";
// e.g. text-red-700, hover:bg-amber-50, bg-green-50/40, dark:border-red-200
const RAW_CLASS = new RegExp(
  `\\b(?:[a-z-]+:)*(?:${UTILITY})-(?:${PALETTE})-\\d{2,3}(?:\\/\\d{1,3})?\\b`,
  "g"
);
/*
 * The two holes the palette rule left (October 2026). `text-white` and
 * `bg-white` carry no number, so they never matched — avatar initials, a
 * switch knob and the date picker's selected day all shipped raw white, and the
 * date picker's measured 2.5:1 in dark. And an arbitrary hex in brackets is a
 * colour no token chose. `on-brand`, `on-tone`, `knob` and friends are the
 * tokens for white-on-a-fill.
 */
const RAW_MONO = new RegExp(
  `\\b(?:[a-z-]+:)*(?:${UTILITY})-(?:white|black)(?:\\/\\d{1,3})?\\b`,
  "g"
);
const RAW_HEX = new RegExp(
  `\\b(?:[a-z-]+:)*(?:${UTILITY})-\\[#[0-9a-fA-F]{3,8}\\]`,
  "g"
);
const PATTERNS = [RAW_CLASS, RAW_MONO, RAW_HEX];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(path, out);
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

const hits = [];
for (const path of walk(SRC)) {
  const rel = relative(ROOT, path);
  if (ALLOWLIST.has(rel)) continue;
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, i) => {
      for (const re of PATTERNS) {
        for (const match of line.matchAll(re)) {
          hits.push({ where: `${rel}:${i + 1}`, cls: match[0] });
        }
      }
    });
}

for (const { where, cls } of hits) console.log(`  ${where}  ${cls}`);

const byClass = new Map();
for (const { cls } of hits) byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
const files = new Set(hits.map((h) => h.where.split(":")[0])).size;

if (hits.length === 0) {
  console.log("check-colors: no raw palette classes in src/");
  process.exit(0);
}

console.log(
  `\ncheck-colors: ${hits.length} raw palette class(es) across ${files} file(s), ` +
    `${byClass.size} distinct — use the semantic tokens in src/app/globals.css`
);
const worst = [...byClass].sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log(`  most common: ${worst.map(([c, n]) => `${c} ×${n}`).join(", ")}`);
process.exit(WARN ? 0 : 1);
