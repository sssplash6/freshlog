import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! }) });

/** Scheduled classes for the page snapshots: the Flexible Program schedules them; a few rows this month and last. */
async function main() {
  const flex = await prisma.program.findFirstOrThrow({ where: { name: "Flexible Program" } });
  await prisma.program.update({ where: { id: flex.id }, data: { schedulesClasses: true } });
  const akmal = await prisma.user.findUniqueOrThrow({ where: { email: "akmal@freshman.academy" } });
  const students = await prisma.studentProfile.findMany({ where: { enrollments: { some: { programId: flex.id } } }, take: 2 });
  if (students.length === 0) throw new Error("No student in the Flexible Program");
  await prisma.scheduledClass.deleteMany({ where: { programId: flex.id } });
  const at = (iso: string) => new Date(iso);
  const rows = [
    { studentId: students[0].id, startsAt: at("2026-10-03T10:00:00Z"), minutes: 90, status: "HELD", topic: "Reading" },
    { studentId: students[0].id, startsAt: at("2026-10-27T14:30:00Z"), minutes: 60, status: "SCHEDULED", topic: "Math" },
    { studentId: students[students.length - 1].id, startsAt: at("2026-11-05T09:00:00Z"), minutes: 120, status: "SCHEDULED", topic: null },
    { studentId: students[0].id, startsAt: at("2026-10-12T09:00:00Z"), minutes: 45, status: "CANCELLED", topic: "Essay" },
  ];
  for (const r of rows) await prisma.scheduledClass.create({ data: { ...r, programId: flex.id, mentorId: akmal.id } });
  console.log(`seeded ${rows.length} classes for ${students.length} students`);
}
main().finally(() => prisma.$disconnect());
