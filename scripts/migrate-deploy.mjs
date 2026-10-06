#!/usr/bin/env node
/**
 * Apply any pending database migrations before the app starts — safely.
 *
 * Render runs this as the first half of the start command
 * (`npm run db:migrate:safe && npm start`, see render.yaml), so a deploy that
 * adds a migration — the program colours, the levels, the space columns —
 * needs nobody to remember a command. The point of the wrapper over a bare
 * `prisma migrate deploy` is what happens around it:
 *
 *   1. Nothing pending: say so and get out of the way. Most deploys.
 *   2. Something pending: copy the SQLite file FIRST. The database is the whole
 *      product's memory, it lives on a single 1 GB disk with no other copy, and
 *      a migration that goes wrong halfway is the one thing a redeploy cannot
 *      undo. The copy is a `VACUUM INTO`, which is consistent even if the file
 *      is mid-write, and the newest few are kept (older ones are pruned so the
 *      disk does not fill).
 *   3. Apply. If it fails the script exits non-zero and says where the backup
 *      is, which makes Render mark the deploy failed and keep the previous
 *      version serving — a half-migrated database never meets new code.
 *
 * It never seeds, and never resets anything: `migrate deploy` only applies
 * migrations that exist in `prisma/migrations` and are not yet recorded.
 *
 *   node scripts/migrate-deploy.mjs            apply pending migrations
 *   node scripts/migrate-deploy.mjs --check    only report; exit 0 if up to date
 *   KEEP_BACKUPS=5 node scripts/migrate-deploy.mjs
 */
import "dotenv/config";

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const KEEP = Math.max(1, Number(process.env.KEEP_BACKUPS ?? 5));
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

/** The SQLite file DATABASE_URL points at, or null for anything else. */
function databaseFile() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) return null;
  // `file:/data/app.db` is absolute; `file:./prisma/dev.db` is from the cwd.
  return resolve(process.cwd(), url.slice("file:".length).split("?")[0]);
}

function prisma(args, { capture = false } = {}) {
  return spawnSync(NPX, ["prisma", ...args], {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: process.env,
  });
}

/** Whether `prisma migrate status` says migrations are waiting. */
function pending() {
  // A file that does not exist yet (or is empty) is a fresh database: all of
  // the migrations are waiting, and `migrate status` has nothing to read.
  const file = databaseFile();
  if (file && (!existsSync(file) || statSync(file).size === 0)) {
    return { waiting: true, text: "" };
  }
  const status = prisma(["migrate", "status"], { capture: true });
  const text = `${status.stdout ?? ""}\n${status.stderr ?? ""}`;
  if (status.status === 0) return { waiting: false, text };
  // Non-zero is "something is pending" OR "something is wrong". Only the
  // first is ours to fix; the rest is surfaced untouched.
  if (/have not yet been applied|Following migrations? have not/i.test(text)) {
    return { waiting: true, text };
  }
  // A brand-new database has no migrations table at all: Prisma says the
  // database schema is not empty / not managed, or that nothing is applied.
  if (/No migration found|database schema is not empty|P3005|no such table: _prisma_migrations/i.test(text)) {
    return { waiting: true, text };
  }
  console.error(text.trim());
  console.error("\nmigrate-deploy: could not tell whether migrations are pending.");
  process.exit(status.status ?? 1);
}

async function backup(file) {
  const { default: Database } = await import("better-sqlite3");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const dest = `${file}.pre-migrate-${stamp}`;
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  return dest;
}

/** Keep the newest KEEP backups beside the database file, delete the rest. */
function prune(file) {
  const dir = dirname(file);
  const prefix = `${basename(file)}.pre-migrate-`;
  const mine = readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const old of mine.slice(KEEP)) rmSync(join(dir, old.name), { force: true });
}

const { waiting, text } = pending();

if (!waiting) {
  console.log("migrate-deploy: database is up to date.");
  process.exit(0);
}

const listed = text.match(/\d{14}_[\w-]+/g) ?? [];
console.log(
  `migrate-deploy: pending migrations${listed.length ? `: ${[...new Set(listed)].join(", ")}` : ""}`,
);

if (CHECK_ONLY) process.exit(1);

const file = databaseFile();
let saved = null;
if (file && existsSync(file) && statSync(file).size > 0) {
  try {
    saved = await backup(file);
    prune(file);
    console.log(`migrate-deploy: backed up the database to ${saved}`);
  } catch (error) {
    // No backup, no migration: it is the one safety net there is.
    console.error(`migrate-deploy: could not back up ${file}: ${error.message}`);
    process.exit(1);
  }
} else {
  console.log("migrate-deploy: no existing database file, so nothing to back up.");
}

const deploy = prisma(["migrate", "deploy"]);
if (deploy.status !== 0) {
  console.error(
    `\nmigrate-deploy: migration FAILED${saved ? `. The database before it is at ${saved}` : ""}.` +
      "\nThe deploy is stopped so the new code never runs on a half-migrated database.",
  );
  process.exit(deploy.status ?? 1);
}
console.log("migrate-deploy: migrations applied.");
