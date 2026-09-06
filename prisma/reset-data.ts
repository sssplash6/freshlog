// DANGER — erases ALL data in the database (users, students, sessions, hour
// allocations, notifications, feedback, mentor assignments, cohorts, programs),
// leaving an empty schema. Pair it with `npm run db:seed` to rebuild the clean
// launch state (the three programs + the admin from config/app-config.ts).
//
// Guarded so it can never run by accident: it refuses unless RESET_CONFIRM is
// set to the exact string "WIPE".
//
//   Local:  RESET_CONFIRM=WIPE npm run db:reset-data && npm run db:seed
//   Render: open the service Shell and run the same two commands (DATABASE_URL
//           already points at the mounted /data/app.db there).

import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

if (process.env.RESET_CONFIRM !== "WIPE") {
  console.error(
    'Refusing to run: this erases ALL data. Re-run with RESET_CONFIRM="WIPE" to confirm.'
  );
  process.exit(1);
}

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Delete children before parents so the RESTRICT foreign keys stay happy.
  await prisma.notification.deleteMany();
  await prisma.interview.deleteMany();
  await prisma.session.deleteMany();
  await prisma.hourAllotmentChange.deleteMany();
  await prisma.hourAllocation.deleteMany();
  // After the sessions that point at them (SetNull would spare the session,
  // but the RESTRICT from Program to Assignment still has to be cleared).
  await prisma.assignment.deleteMany();
  await prisma.mentorFeedback.deleteMany();
  await prisma.mentorAssignment.deleteMany();
  // Enrollments cascade with the profile, but the RESTRICT on Program means
  // they have to be gone before the programs are — so they are named here.
  await prisma.studentEnrollment.deleteMany();
  await prisma.studentProfile.deleteMany();
  await prisma.cohort.deleteMany();
  await prisma.user.deleteMany();
  await prisma.program.deleteMany();
  console.log("All data erased. Run `npm run db:seed` to restore programs + admin.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
