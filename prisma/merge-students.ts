// Folds one student's account into another (the same person entered twice).
//
//   MERGE_KEEP="Arslan Hodjaev" MERGE_DROP="Arslan Khodjayev" npm run db:merge-students
//       dry run: prints both accounts and every row that would move, writes nothing
//   MERGE_KEEP=... MERGE_DROP=... MERGE_CONFIRM=WRITE npm run db:merge-students
//       copies the database beside itself first, then writes
//
// MERGE_KEEP and MERGE_DROP each name one student by email or by full name
// (any case). The kept account's name and email stand; the dropped one's
// email stops signing in. Rules for what moves, what is a duplicate and what
// refuses the merge are in src/lib/merge-students.ts.

import "dotenv/config";

import { resolve } from "node:path";

import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { MergeRefused, mergeStudents, type MergeReport } from "../src/lib/merge-students";

const WRITE = process.env.MERGE_CONFIRM === "WRITE";
const url = process.env.DATABASE_URL!;
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

const WITH = { user: true, enrollments: { include: { program: { select: { name: true } } } } } as const;
type Student = Prisma.StudentProfileGetPayload<{ include: typeof WITH }>;

/** The one student `wanted` names, or exit listing why not. */
async function find(wanted: string | undefined, role: string) {
  if (!wanted) fail(`Set MERGE_${role} to the student's email or full name.`);
  const needle = wanted.trim().toLowerCase();
  const all = await prisma.studentProfile.findMany({ include: WITH });
  const hits = all.filter(
    (p) => p.user.email.toLowerCase() === needle || (p.user.name ?? "").trim().toLowerCase() === needle
  );
  if (hits.length !== 1) {
    const close = all.filter((p) => `${p.user.name} ${p.user.email}`.toLowerCase().includes(needle.split(" ")[0]));
    fail(
      `MERGE_${role}="${wanted}" matches ${hits.length} students.` +
        (close.length ? `\nStudents whose name or email has "${needle.split(" ")[0]}":\n${close.map(describe).join("\n")}` : "")
    );
  }
  return hits[0];
}

function describe(p: Student) {
  return `  ${p.user.name ?? "(no name)"} <${p.user.email}>  ${p.user.status}, since ${p.createdAt.toISOString().slice(0, 10)}, in ${p.enrollments.map((e) => e.program.name).join(", ") || "no program"}`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** The dry run: the merge runs for real, and this undoes it. */
class Rollback extends Error {
  constructor(readonly report: MergeReport) {
    super("dry run");
  }
}

async function main() {
  const keep = await find(process.env.MERGE_KEEP, "KEEP");
  const drop = await find(process.env.MERGE_DROP, "DROP");
  console.log(`KEEP\n${describe(keep)}\nDROP\n${describe(drop)}\n`);

  if (WRITE) {
    const file = resolve(process.cwd(), url.slice("file:".length).split("?")[0]);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const dest = `${file}.pre-merge-${stamp}`;
    const db = new Database(file, { readonly: true, fileMustExist: true });
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    db.close();
    console.log(`Backup: ${dest}\n`);
  }

  let report: MergeReport;
  try {
    report = await prisma.$transaction(async (tx) => {
      const r = await mergeStudents(tx, keep.id, drop.id);
      if (!WRITE) throw new Rollback(r);
      return r;
    });
  } catch (e) {
    if (e instanceof Rollback) report = e.report;
    else if (e instanceof MergeRefused) fail(`Nothing written. Resolve these by hand first:\n${e.clashes.map((c) => `  - ${c}`).join("\n")}`);
    else throw e;
  }

  const lines = (r: Record<string, number>) => Object.entries(r).map(([k, n]) => `  ${n} ${k}`).join("\n") || "  none";
  console.log(`${WRITE ? "Moved" : "Would move"}:\n${lines(report.moved)}`);
  console.log(`${WRITE ? "Discarded" : "Would discard"} as duplicates:\n${lines(report.discarded)}`);
  console.log(`Notes:\n${report.notes.map((n) => `  - ${n}`).join("\n")}`);
  console.log(WRITE ? "\nMerged." : "\nDry run: nothing written. Add MERGE_CONFIRM=WRITE to apply.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
