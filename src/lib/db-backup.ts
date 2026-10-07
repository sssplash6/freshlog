import Database from "better-sqlite3";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

/** How many days of daily backups stay on the disk. */
export const KEEP_DAYS = 30;

const NAME = /^app-(\d{4}-\d{2}-\d{2})\.db\.gz$/;

/** The SQLite file DATABASE_URL points at, or null for anything else. */
export function databaseFile(url = process.env.DATABASE_URL ?? ""): string | null {
  if (!url.startsWith("file:")) return null;
  // `file:/data/app.db` is absolute; `file:./prisma/dev.db` is from the cwd.
  // The path is chosen at runtime by the environment; the bundler must not try
  // to trace it into the build.
  return resolve(/*turbopackIgnore: true*/ process.cwd(), url.slice("file:".length).split("?")[0]);
}

export type BackupResult = {
  /** Absolute path of the compressed copy. */
  file: string;
  /** Size of that copy on disk. */
  bytes: number;
  /** Backups kept after pruning, newest first, by file name. */
  kept: string[];
  /** Backups deleted for being older than the retention window. */
  pruned: string[];
};

/**
 * Copy the live database to `<dir of the db>/backups/app-YYYY-MM-DD.db.gz`.
 *
 * `VACUUM INTO` takes a consistent snapshot while the app keeps serving, which
 * a plain file copy of a database in use does not promise. The copy is checked
 * (`integrity_check`) before it is compressed, and written under a temporary
 * name then renamed, so a crash never leaves a half-written file wearing a
 * good backup's name. A second run on the same UTC day replaces that day's file.
 *
 * Lives beside the database, on the same disk: this guards against a bad
 * migration, a corrupted file or a wrong edit, not the loss of the disk itself.
 */
export async function backupDatabase(now = new Date(), keepDays = KEEP_DAYS): Promise<BackupResult> {
  const source = databaseFile();
  if (!source) throw new Error("DATABASE_URL is not a SQLite file, so there is nothing to copy.");
  if (!(await stat(source).catch(() => null))?.size) {
    throw new Error(`No database at ${source}.`);
  }

  const dir = join(dirname(source), "backups");
  await mkdir(dir, { recursive: true });

  const day = now.toISOString().slice(0, 10);
  const plain = join(dir, `.app-${day}.db.tmp`);
  const zipped = join(dir, `.app-${day}.db.gz.tmp`);
  const final = join(dir, `app-${day}.db.gz`);
  await rm(plain, { force: true });

  try {
    const db = new Database(source, { readonly: true, fileMustExist: true });
    try {
      db.exec(`VACUUM INTO '${plain.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }

    const copy = new Database(plain, { readonly: true });
    try {
      const verdict = copy.pragma("integrity_check", { simple: true });
      if (verdict !== "ok") throw new Error(`Backup failed its integrity check: ${String(verdict)}`);
    } finally {
      copy.close();
    }

    await pipeline(createReadStream(plain), createGzip({ level: 9 }), createWriteStream(zipped));
    await rename(zipped, final);
  } finally {
    await rm(plain, { force: true });
    await rm(zipped, { force: true });
  }

  const cutoff = new Date(now.getTime() - keepDays * 86_400_000).toISOString().slice(0, 10);
  const names = (await readdir(dir)).filter((n) => NAME.test(n)).sort().reverse();
  const pruned = names.filter((n) => NAME.exec(n)![1] < cutoff);
  for (const old of pruned) await rm(join(dir, old), { force: true });

  return {
    file: final,
    bytes: (await stat(final)).size,
    kept: names.filter((n) => !pruned.includes(n)),
    pruned,
  };
}
