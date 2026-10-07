#!/usr/bin/env node
/**
 * Put a daily backup back as the live database.
 *
 *   node scripts/restore-backup.mjs                      # list what there is
 *   node scripts/restore-backup.mjs 2026-10-07           # restore that day
 *   node scripts/restore-backup.mjs /path/to/app-X.db.gz # or a file
 *
 * Run it over SSH on the web service. The backups sit in <db dir>/backups,
 * written by /api/cron/db-backup. The database as it is NOW is kept first as
 * app.db.before-restore-<stamp>, so a restore of the wrong day can be undone.
 *
 * The app holds the database file open, so SUSPEND THE SERVICE FIRST (or
 * restart it straight after): a running process keeps writing to the file this
 * replaced, and those writes are lost.
 */
import Database from "better-sqlite3";
import { createReadStream, createWriteStream, existsSync, readdirSync, renameSync, rmSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

const url = process.env.DATABASE_URL ?? "";
if (!url.startsWith("file:")) {
  console.error("restore-backup: DATABASE_URL is not a SQLite file.");
  process.exit(1);
}
const target = resolve(process.cwd(), url.slice("file:".length).split("?")[0]);
const dir = join(dirname(target), "backups");
const available = existsSync(dir)
  ? readdirSync(dir).filter((n) => /^app-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(n)).sort().reverse()
  : [];

const arg = process.argv[2];
if (!arg) {
  console.log(available.length ? `Backups in ${dir}:\n${available.map((n) => `  ${n}`).join("\n")}` : `No backups in ${dir}.`);
  process.exit(0);
}

const source = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? join(dir, `app-${arg}.db.gz`) : resolve(arg);
if (!existsSync(source)) {
  console.error(`restore-backup: ${source} does not exist.`);
  process.exit(1);
}

const staged = `${target}.restoring`;
rmSync(staged, { force: true });
await pipeline(createReadStream(source), createGunzip(), createWriteStream(staged));

const check = new Database(staged, { readonly: true });
const verdict = check.pragma("integrity_check", { simple: true });
check.close();
if (verdict !== "ok") {
  rmSync(staged, { force: true });
  console.error(`restore-backup: that backup fails its integrity check (${verdict}); nothing was changed.`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const before = `${target}.before-restore-${stamp}`;
if (existsSync(target)) copyFileSync(target, before);
// A leftover journal belongs to the file being replaced, not to the backup.
for (const suffix of ["-journal", "-wal", "-shm"]) rmSync(`${target}${suffix}`, { force: true });
renameSync(staged, target);

console.log(`Restored ${source}\nThe database it replaced is at ${before}\nNow restart the service.`);
