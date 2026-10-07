import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { backupDatabase } from "@/lib/db-backup";

let dir: string;
let original: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "backup-test-"));
  original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(dir, "app.db")}`;
  const db = new Database(join(dir, "app.db"));
  db.exec("CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1), (2), (3);");
  db.close();
});

afterEach(() => {
  process.env.DATABASE_URL = original;
  rmSync(dir, { recursive: true, force: true });
});

describe("backupDatabase", () => {
  it("writes a compressed copy that opens and holds the rows", async () => {
    const result = await backupDatabase(new Date("2026-10-07T02:00:00Z"));
    expect(result.file).toBe(join(dir, "backups", "app-2026-10-07.db.gz"));

    const restored = join(dir, "restored.db");
    writeFileSync(restored, gunzipSync(readFileSync(result.file)));
    const db = new Database(restored, { readonly: true });
    expect(db.prepare("SELECT COUNT(*) AS c FROM t").get()).toEqual({ c: 3 });
    db.close();
  });

  it("replaces the same day's file on a second run and leaves no temp files", async () => {
    await backupDatabase(new Date("2026-10-07T02:00:00Z"));
    await backupDatabase(new Date("2026-10-07T09:00:00Z"));
    expect(readdirSync(join(dir, "backups"))).toEqual(["app-2026-10-07.db.gz"]);
  });

  it("deletes backups older than the window and keeps the rest", async () => {
    const backups = join(dir, "backups");
    await backupDatabase(new Date("2026-09-01T02:00:00Z"));
    await backupDatabase(new Date("2026-09-20T02:00:00Z"));
    const result = await backupDatabase(new Date("2026-10-07T02:00:00Z"), 30);

    expect(result.pruned).toEqual(["app-2026-09-01.db.gz"]);
    expect(readdirSync(backups).sort()).toEqual(["app-2026-09-20.db.gz", "app-2026-10-07.db.gz"]);
    expect(result.kept).toEqual(["app-2026-10-07.db.gz", "app-2026-09-20.db.gz"]);
  });

  it("refuses when there is no database", async () => {
    rmSync(join(dir, "app.db"));
    await expect(backupDatabase()).rejects.toThrow(/No database/);
  });

  it("refuses a database that is not a SQLite file", async () => {
    process.env.DATABASE_URL = "postgres://example/db";
    await expect(backupDatabase()).rejects.toThrow(/not a SQLite file/);
  });
});

describe("scripts/restore-backup.mjs", () => {
  const run = (...args: string[]) =>
    execFileSync("node", ["scripts/restore-backup.mjs", ...args], {
      env: { ...process.env, DATABASE_URL: `file:${join(dir, "app.db")}` },
      encoding: "utf8",
    });
  const rows = () => {
    const db = new Database(join(dir, "app.db"), { readonly: true });
    const { c } = db.prepare("SELECT COUNT(*) AS c FROM t").get() as { c: number };
    db.close();
    return c;
  };

  it("puts a day's backup back and keeps what it replaced", async () => {
    await backupDatabase(new Date("2026-10-07T02:00:00Z"));
    const db = new Database(join(dir, "app.db"));
    db.exec("DELETE FROM t");
    db.close();
    expect(rows()).toBe(0);

    const out = run("2026-10-07");
    expect(rows()).toBe(3);
    expect(out).toMatch(/Restored/);
    expect(readdirSync(dir).some((n) => n.startsWith("app.db.before-restore-"))).toBe(true);
  });

  it("lists backups when given no argument", async () => {
    await backupDatabase(new Date("2026-10-07T02:00:00Z"));
    expect(run()).toMatch(/app-2026-10-07\.db\.gz/);
  });

  it("changes nothing when the day has no backup", () => {
    expect(() => run("2026-01-01")).toThrow();
    expect(rows()).toBe(3);
  });
});

