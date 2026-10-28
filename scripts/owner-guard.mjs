#!/usr/bin/env node
/**
 * Refuse a push that deletes what the repo's owner decided recently.
 *
 * Between 23 September and 6 October 2026, six of the owner's decisions were
 * undone by commits pushed from here: how Assigned adds up, who may grant
 * their own hours, how past hours enter an hour bank, where a student page's
 * Back link goes, the access table's columns, the session form's layout. None
 * of it was a git accident. Each was an agent "fixing" code it read as wrong,
 * without reading the commit that had made it that way a few days before — the
 * reasons were in his commit messages and comments, and went out with the
 * code. He found out from production, and undid one of them himself.
 *
 * So this runs as the pre-push hook. For every commit being pushed that is not
 * his, it blames the lines the commit deletes and stops the push when MIN_LINES
 * or more of them come from one commit of his in the last WINDOW_DAYS. A line
 * deleted here and added back elsewhere in the same commit was moved, not
 * removed, and does not count.
 *
 * The two numbers were set against the 120 commits pushed from here between
 * 23 September and 9 October: 21 days and three lines stops 27 of them, all
 * six decisions above among them. Thirty days and one line stopped 58, which
 * is a guard that gets bypassed by habit. Fourteen days missed the session
 * form, whose layout was 15 to 19 days old when it was rewritten.
 *
 * A commit gets past it with an `Owner-reviewed:` trailer saying why his
 * decision survives, or who agreed to change it — AGENTS.md says when an agent
 * may write that itself and when it must ask first.
 *
 *   node scripts/owner-guard.mjs <commit>...     check those commits
 *   node scripts/owner-guard.mjs origin/main..   check a range
 *
 * Git does not version hooks, so each clone installs it once:
 *
 *   printf '#!/bin/sh\nOWNER_GUARD_HOOK=1 exec node scripts/owner-guard.mjs "$@"\n' \
 *     > .git/hooks/pre-push && chmod +x .git/hooks/pre-push
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const OWNER_EMAIL = "probhumanoid@gmail.com";
const OWNER_NAME = "freshmanac";
const WINDOW_DAYS = 21;
const MIN_LINES = 3;
const TRAILER = "Owner-reviewed:";
const SKIP_FILES = /(^|\/)(CHANGELOG\.md|package-lock\.json)$/;
const ZERO = /^0+$/;

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

/** Long enough to be a decision rather than a brace, a `</div>` or a blank. */
function meaningful(line) {
  const s = line.trim();
  return s.length >= 12 && !/^[\W_]+$/.test(s);
}

function commitsToCheck() {
  const args = process.argv.slice(2);
  // Run by hand: the arguments are commits or ranges.
  if (args.length > 0 && !process.env.OWNER_GUARD_HOOK) {
    return git("rev-list", "--no-merges", "--no-walk", ...args).split("\n").filter(Boolean);
  }
  // Run as pre-push: `<local ref> <local sha> <remote ref> <remote sha>` per line,
  // and the commits that matter are the ones the remote has not seen yet.
  const remote = args[0] || "origin";
  const shas = new Set();
  for (const line of readFileSync(0, "utf8").split("\n")) {
    const [, local, , remoteSha] = line.trim().split(/\s+/);
    if (!local || ZERO.test(local)) continue; // a branch being deleted
    const not = ["--not", `--remotes=${remote}`];
    if (remoteSha && !ZERO.test(remoteSha)) {
      try {
        git("cat-file", "-e", `${remoteSha}^{commit}`);
        not.push(remoteSha);
      } catch {
        // Their tip is not here yet; the remote-tracking refs still bound the walk.
      }
    }
    for (const sha of git("rev-list", "--no-merges", local, ...not).split("\n")) {
      if (sha) shas.add(sha);
    }
  }
  return [...shas];
}

/** Old path → old line numbers deleted, plus every line the commit adds anywhere. */
function readDiff(sha) {
  const removed = new Map();
  const added = new Set();
  let path = null;
  let line = 0;
  for (const row of git("diff", "-U0", "-M", `${sha}^`, sha).split("\n")) {
    if (row.startsWith("--- ")) {
      path = row.startsWith("--- a/") ? row.slice(6) : null;
    } else if (row.startsWith("+++ ")) {
      // nothing: deletions are blamed on the OLD path
    } else if (row.startsWith("@@")) {
      line = Number(/^@@ -(\d+)/.exec(row)[1]);
    } else if (row.startsWith("-")) {
      if (path && !SKIP_FILES.test(path) && meaningful(row.slice(1))) {
        if (!removed.has(path)) removed.set(path, []);
        removed.get(path).push(line);
      }
      line++;
    } else if (row.startsWith("+")) {
      added.add(row.slice(1).trim());
    }
  }
  return { removed, added };
}

/** Who wrote each of those lines, read in the commit's parent. */
function blame(sha, path, lines) {
  const ranges = lines.flatMap((n) => ["-L", `${n},${n}`]);
  const out = git("blame", "--porcelain", "-w", "-M", ...ranges, `${sha}^`, "--", path);
  const commits = new Map();
  const result = [];
  let current = null;
  for (const row of out.split("\n")) {
    const header = /^([0-9a-f]{40}) \d+ \d+/.exec(row);
    if (header) {
      if (!commits.has(header[1])) commits.set(header[1], { sha: header[1] });
      current = commits.get(header[1]);
    } else if (row.startsWith("author-mail ")) {
      current.email = row.slice(12).replace(/[<>]/g, "");
    } else if (row.startsWith("author-time ")) {
      current.time = Number(row.slice(12));
    } else if (row.startsWith("summary ")) {
      current.summary = row.slice(8);
    } else if (row.startsWith("\t")) {
      result.push({ commit: current, text: row.slice(1) });
    }
  }
  return result;
}

function check(sha) {
  const [author, time, subject, body] = git(
    "show", "-s", "--format=%ae%x00%ct%x00%s%x00%B", sha
  ).split("\0");
  if (author === OWNER_EMAIL) return null; // he may change his own mind
  if (body.split("\n").some((l) => l.startsWith(TRAILER))) return null;
  if (git("rev-list", "--parents", "-n", "1", sha).trim().split(" ").length < 2) return null;

  const since = Number(time) - WINDOW_DAYS * 86400;
  const { removed, added } = readDiff(sha);
  const his = new Map(); // his commit → path → lines
  for (const [path, lines] of removed) {
    for (const { commit, text } of blame(sha, path, lines)) {
      if (commit.email !== OWNER_EMAIL || commit.time < since) continue;
      if (added.has(text.trim())) continue; // moved, not removed
      if (!his.has(commit.sha)) his.set(commit.sha, { commit, files: new Map() });
      const files = his.get(commit.sha).files;
      if (!files.has(path)) files.set(path, []);
      files.get(path).push(text.trim());
    }
  }
  for (const [key, { files }] of his) {
    if ([...files.values()].flat().length < MIN_LINES) his.delete(key);
  }
  return his.size > 0 ? { sha, subject, his } : null;
}

const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const findings = commitsToCheck().map(check).filter(Boolean);

if (findings.length === 0) process.exit(0);

const out = [];
out.push(
  "",
  `owner-guard: this deletes lines ${OWNER_NAME} (the repo's owner) wrote in the last ${WINDOW_DAYS} days.`,
  ""
);
const SHOW = 6;
for (const { sha, subject, his } of findings) {
  out.push(`  ${sha.slice(0, 7)}  ${subject}`);
  // Most lines first: the commit whose decision went furthest is the one to read.
  const ranked = [...his.values()]
    .map(({ commit, files }) => ({ commit, files, n: [...files.values()].flat().length }))
    .sort((a, b) => b.n - a.n);
  for (const { commit, files, n } of ranked.slice(0, SHOW)) {
    out.push(`    his ${commit.sha.slice(0, 7)} (${day(commit.time)}) "${commit.summary}"`);
    out.push(`      ${n} line${n === 1 ? "" : "s"} in ${[...files.keys()].join(", ")}`);
    for (const text of [...files.values()].flat().slice(0, 2)) {
      out.push(`        - ${text.slice(0, 100)}`);
    }
  }
  if (ranked.length > SHOW) {
    const rest = ranked.slice(SHOW).reduce((sum, r) => sum + r.n, 0);
    out.push(`    … and ${rest} lines from ${ranked.length - SHOW} more of his commits`);
  }
  out.push("");
}
out.push(
  "Read each of his commits (git show <sha>) before going on. Then either:",
  "  - restore what he decided, and keep your change around it; or",
  `  - add a trailer to that commit and push again — see "The owner's recent`,
  `    decisions" in AGENTS.md for when you may write it yourself. On the last`,
  `    commit: git commit --amend --no-edit --trailer "${TRAILER} <why>"`,
  ""
);
process.stderr.write(out.join("\n"));
process.exit(1);
