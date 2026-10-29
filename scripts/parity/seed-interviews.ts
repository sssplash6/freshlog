import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! }) });

/** Practice interviews for the page snapshots: offered times, a booked pair, a mentor's done one, and an absent one. */
async function main() {
  const user = (email: string) => prisma.user.findUniqueOrThrow({ where: { email } });
  const [malika, jasur, dilnoza, madina] = await Promise.all([
    user("malika@student.example.com"),
    user("jasur@student.example.com"),
    user("dilnoza@freshman.academy"),
    user("madina@student.example.com"),
  ]);
  await prisma.interviewFeedback.deleteMany({});
  await prisma.peerInterview.deleteMany({});
  await prisma.interviewSlot.deleteMany({});
  // Wall clock in the UTC fields, as the app stores it.
  const at = (iso: string) => new Date(iso);
  const slot = (userId: string, startsAt: string, minutes: number, asMentor = false) =>
    prisma.interviewSlot.create({ data: { userId, startsAt: at(startsAt), minutes, asMentor } });
  // Open times: a classmate's, a mentor's for her students.
  await slot(jasur.id, "2026-11-12T15:00:00Z", 45);
  await slot(dilnoza.id, "2026-11-14T16:00:00Z", 60, true);
  // Booked between two students, coming up.
  const s1 = await slot(jasur.id, "2026-11-10T15:00:00Z", 30);
  await prisma.peerInterview.create({ data: { slotId: s1.id, hostId: jasur.id, guestId: malika.id, template: "university-admissions" } });
  // A mentor's interview with a student, done, with the mentor's feedback sent.
  const s2 = await slot(dilnoza.id, "2026-10-20T15:00:00Z", 45, true);
  const done = await prisma.peerInterview.create({
    data: { slotId: s2.id, hostId: dilnoza.id, guestId: malika.id, mentorId: dilnoza.id, template: "scholarship", completedAt: at("2026-10-20T16:00:00Z") },
  });
  await prisma.interviewFeedback.create({
    data: { interviewId: done.id, fromId: dilnoza.id, summary: "Clear answers.", wentWell: "Structure.", toImprove: "Pace.", submittedAt: at("2026-10-20T16:05:00Z") },
  });
  // Ended and nobody marked it: to mark.
  const s3 = await slot(madina.id, "2026-10-25T15:00:00Z", 30);
  await prisma.peerInterview.create({ data: { slotId: s3.id, hostId: madina.id, guestId: malika.id, template: "behavioral" } });
  // A student who didn't come.
  const s4 = await slot(dilnoza.id, "2026-10-15T15:00:00Z", 30, true);
  await prisma.peerInterview.create({ data: { slotId: s4.id, hostId: dilnoza.id, guestId: madina.id, mentorId: dilnoza.id, template: "behavioral", absentId: madina.id } });
  console.log("seeded interviews");
}
main().finally(() => prisma.$disconnect());
