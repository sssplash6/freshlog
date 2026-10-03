// Idempotent seed: inserts the three programs, their starter cohorts, and the
// bootstrap platform admin from config/app-config.ts. Safe to re-run after
// editing the config (uses upserts; never deletes).
//
// It deliberately writes NO program-access grants. Admin access lives in
// ProgramStaff, which only /settings/platform writes — see the note there.
//
// Run with: npx prisma db seed

import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { PROGRAMS, STAFF_SEED } from "../config/app-config";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Programs and their starter cohorts — and their levels, where the program
  // is leveled. `findFirst` + `create`, not `upsert`: a cohort's name is
  // unique per (program, level) now, and a level's per program — no single
  // compound selector names them.
  for (const { name, cohorts, levels, institute } of PROGRAMS) {
    const program = await prisma.program.upsert({
      where: { name },
      // Never on update: whether it is an institute is the platform admin's
      // call once the program exists, and the seed runs on every boot.
      update: {},
      create: institute
        ? { name, space: "INSTITUTE", spaceName: institute }
        : { name },
    });
    for (const spec of levels ?? []) {
      const level = await prisma.programLevel.findFirst({
        where: { programId: program.id, name: spec.name },
      });
      if (!level) {
        await prisma.programLevel.create({
          data: {
            programId: program.id,
            name: spec.name,
            standardMinutes: spec.standardMinutes,
            standardDays: spec.standardDays,
          },
        });
      }
    }
    for (const cohortName of cohorts) {
      const existing = await prisma.cohort.findFirst({
        where: { programId: program.id, levelId: null, name: cohortName },
      });
      if (!existing) {
        await prisma.cohort.create({
          data: { programId: program.id, name: cohortName },
        });
      }
    }
    console.log(
      `Program "${name}" (${levels?.length ?? 0} level(s), ${cohorts.length} cohort(s))`
    );
  }

  // The bootstrap admin. Everyone else who administers anything is a
  // ProgramStaff row, written from /settings/platform and NEVER from here:
  // this file runs on every boot (render.yaml), so a grant seeded from config
  // would come back the next time the app restarted, undoing a removal the
  // owner had just made.
  for (const staff of STAFF_SEED) {
    const email = staff.email.toLowerCase();
    await prisma.user.upsert({
      where: { email },
      update: {
        role: staff.role,
        isMentor: staff.isMentor ?? false,
        platformAdmin: staff.platformAdmin,
      },
      create: {
        email,
        name: staff.name,
        role: staff.role,
        status: "ACTIVE",
        isMentor: staff.isMentor ?? false,
        platformAdmin: staff.platformAdmin,
      },
    });
    console.log(`Platform admin ${email}${staff.isMentor ? " + mentor" : ""}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Seeding finished.");
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
