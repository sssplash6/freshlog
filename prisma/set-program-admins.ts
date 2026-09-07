// Sets who administers which program, from one list.
//
//   npm run admins                       # dry run: reports, writes nothing
//   ADMINS_CONFIRM=WRITE npm run admins   # writes
//
// WHY A SCRIPT AND NOT THE SETTINGS PAGE
// Access is already editable at /settings/platform, one person at a time. This
// exists because the list below is the RECORD of who runs what — it can be read
// in a diff, reviewed before it runs, and re-applied to a fresh database or to
// production without anybody clicking through nine people. The page is for
// changing one person's access; this is for stating everybody's at once.
//
// WHAT IT DOES
//   - grants ADMIN on each program named for a person
//   - REVOKES any ADMIN grant that person holds on a program NOT named here
//   - leaves LEADER and SALES grants alone: this file is about administration
//   - leaves `platformAdmin` alone. That flag is access to everything and is
//     not a per-program grant; it is set by hand, deliberately, and a script
//     that could hand it out is a script nobody should run.
//
// Re-running is safe: the same list applied twice makes no writes the second
// time, and the report says so.
//
// THE REVOKE IS THE POINT, AND IT IS THE DANGEROUS HALF. Every admin currently
// holds every program — the state HANDOFF.md flags as never having been
// exercised — so the first live run TAKES access away from most people. Read
// the dry run before confirming.

import "dotenv/config";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { ROLES } from "../src/lib/constants";

const WRITE = process.env.ADMINS_CONFIRM === "WRITE";
const DOMAIN = "freshman.academy";

/**
 * Who administers what, by program NAME as it appears in the database.
 *
 * Names, not ids, so this file is readable and survives a reseed. A name that
 * matches no program is reported and skipped rather than guessed at — a
 * silently-skipped grant is somebody who cannot open the page they are
 * responsible for.
 */
const ADMINS: Record<string, string[]> = {
  "sega@freshman.academy": ["Global Admissions Program", "Flexible Program"],
  "sanjar@freshman.academy": ["Global Admissions Program"],
  "assistant@freshman.academy": ["Global Admissions Program"],
  "sharofiddin@freshman.academy": ["Master's Program"],
  "khusanboy@freshman.academy": ["Imkon Scholars"],
  // "Any research program" — all three of them, so a fourth one opened next
  // term needs a line here rather than inheriting quietly.
  "nigel@freshman.academy": [
    "Advanced Research Program",
    "Emerging Researchers Program",
    "Frontiers Researchers Program",
  ],
  "valera@freshman.academy": ["Full Support", "Pre-Full Support"],
};

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const programs = await prisma.program.findMany({
    select: { id: true, name: true },
  });
  const byName = new Map(programs.map((p) => [p.name.toLowerCase(), p]));

  const wanted = new Map<string, Set<string>>();
  const missingPrograms = new Set<string>();

  for (const [email, names] of Object.entries(ADMINS)) {
    if (!email.endsWith(`@${DOMAIN}`)) {
      console.error(`  ! ${email} is not an @${DOMAIN} address — skipped`);
      continue;
    }
    const ids = new Set<string>();
    for (const name of names) {
      const program = byName.get(name.toLowerCase());
      if (!program) {
        missingPrograms.add(name);
        continue;
      }
      ids.add(program.id);
    }
    wanted.set(email.toLowerCase(), ids);
  }

  if (missingPrograms.size > 0) {
    console.log("\nPROGRAMS NAMED HERE THAT DO NOT EXIST:");
    for (const name of missingPrograms) console.log(`  ? ${name}`);
    console.log(
      "  Nothing is granted for these. Create the program, or fix the name above."
    );
  }

  const users = await prisma.user.findMany({
    where: { email: { in: [...wanted.keys()] } },
    select: { id: true, email: true, name: true },
  });
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  for (const email of wanted.keys()) {
    if (!byEmail.has(email)) {
      console.log(`\n  ? ${email} has no account — nothing granted`);
    }
  }

  const programName = new Map(programs.map((p) => [p.id, p.name]));
  const grants: { email: string; programId: string }[] = [];
  const revokes: { email: string; programId: string }[] = [];

  for (const [email, programIds] of wanted) {
    const user = byEmail.get(email);
    if (!user) continue;
    const held = await prisma.programStaff.findMany({
      where: { userId: user.id, role: ROLES.ADMIN },
      select: { programId: true },
    });
    const heldIds = new Set(held.map((h) => h.programId));

    for (const id of programIds) {
      if (!heldIds.has(id)) grants.push({ email, programId: id });
    }
    for (const id of heldIds) {
      if (!programIds.has(id)) revokes.push({ email, programId: id });
    }
  }

  console.log(`\n${WRITE ? "APPLYING" : "DRY RUN"} — ${grants.length} grant(s), ${revokes.length} revoke(s)\n`);
  for (const g of grants) {
    console.log(`  + ${g.email}  ADMIN on  ${programName.get(g.programId)}`);
  }
  for (const r of revokes) {
    console.log(`  - ${r.email}  loses     ${programName.get(r.programId)}`);
  }

  // Anybody holding an ADMIN grant who is not named in the list at all. NOT
  // touched — dropping someone because their line is missing is how a typo
  // locks a person out — but named loudly, because an unlisted admin is either
  // an omission or somebody who should not have it.
  const listed = new Set(byEmail.values().flatMap((u) => [u.id]));
  const others = await prisma.programStaff.findMany({
    where: { role: ROLES.ADMIN, userId: { notIn: [...listed] } },
    include: { user: { select: { email: true } } },
  });
  if (others.length > 0) {
    console.log("\nADMINS NOT NAMED IN THIS FILE (left exactly as they are):");
    const grouped = new Map<string, string[]>();
    for (const o of others) {
      const list = grouped.get(o.user.email) ?? [];
      list.push(programName.get(o.programId) ?? o.programId);
      grouped.set(o.user.email, list);
    }
    for (const [email, names] of grouped) {
      console.log(`  · ${email} — ${names.join(", ")}`);
    }
  }

  if (!WRITE) {
    console.log("\nNothing written. Re-run with ADMINS_CONFIRM=WRITE to apply.");
    return;
  }

  for (const g of grants) {
    const user = byEmail.get(g.email)!;
    await prisma.programStaff.upsert({
      where: { userId_programId: { userId: user.id, programId: g.programId } },
      create: { userId: user.id, programId: g.programId, role: ROLES.ADMIN },
      update: { role: ROLES.ADMIN },
    });
  }
  for (const r of revokes) {
    const user = byEmail.get(r.email)!;
    await prisma.programStaff.deleteMany({
      where: { userId: user.id, programId: r.programId, role: ROLES.ADMIN },
    });
  }
  console.log("\nDone.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
