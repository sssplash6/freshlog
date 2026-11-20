import { describe, expect, it } from "vitest";

import { analyticsData } from "@/lib/analytics";
import { analyticsRatings } from "@/lib/analytics-ratings";
import { prisma } from "@/lib/prisma";
import { grant, mentor, pairing, platformAdmin, program, session, student } from "@/test/db";

/**
 * Who is sent ratings for the figure beside a mentor's rank on Analytics.
 * The page narrows to any days the reader picks, so a row sent is a meeting's
 * score read by its date: nobody is sent a row `/feedback` would not list them.
 */

/** A meeting `studentId` rated `stars`, answered now. */
async function rated(studentId: string, mentorId: string, programId: string, stars: number) {
  const s = await session({ studentId, mentorId, programId, minutes: 60 });
  await prisma.session.update({
    where: { id: s.id },
    data: { studentAnswer: "CONFIRMED", studentRating: stars, studentAnsweredAt: new Date() },
  });
}

/** Two mentors of one program, each with one rated meeting. */
async function scene() {
  const ga = await program("Global Admissions");
  const akmal = await mentor("Akmal Low");
  const dilnoza = await mentor("Dilnoza High");
  await pairing({ mentorId: akmal.id, programId: ga.id });
  await pairing({ mentorId: dilnoza.id, programId: ga.id });
  const aziz = await student({ programId: ga.id, name: "Aziz Tursunov" });
  await rated(aziz.id, akmal.id, ga.id, 2);
  await rated(aziz.id, dilnoza.id, ga.id, 5);
  return { ga, akmal, dilnoza, aziz };
}

async function read(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const data = await analyticsData(undefined);
  const ratings = await analyticsRatings(user, data);
  const indexOf = (id: string) => data.mentors.findIndex((m) => m.id === id);
  return { ratings, indexOf };
}

describe("analyticsRatings", () => {
  it("sends a mentor with no grant nothing, their own included", async () => {
    const { akmal } = await scene();
    expect((await read(akmal.id)).ratings).toBeNull();
  });

  it("sends a platform admin every mentor's ratings", async () => {
    const { akmal, dilnoza } = await scene();
    const { ratings, indexOf } = await read((await platformAdmin()).id);
    expect(ratings?.withheld).toBeNull();
    expect(ratings?.rows.map((r) => [r[0], r[2]]).sort()).toEqual(
      [
        [indexOf(akmal.id), 2],
        [indexOf(dilnoza.id), 5],
      ].sort()
    );
  });

  it("sends an admin who mentors their own, where they administer the program", async () => {
    const { ga, akmal } = await scene();
    await grant({ userId: akmal.id, programId: ga.id });
    const { ratings, indexOf } = await read(akmal.id);
    expect(ratings?.withheld).toBeNull();
    expect(ratings?.rows.some((r) => r[0] === indexOf(akmal.id))).toBe(true);
  });

  it("sends a leader who mentors their colleagues' ratings and none of their own", async () => {
    const { ga, akmal, dilnoza } = await scene();
    await grant({ userId: akmal.id, programId: ga.id, role: "LEADER" });
    const { ratings, indexOf } = await read(akmal.id);
    expect(ratings?.withheld).toBe(indexOf(akmal.id));
    expect(ratings?.rows.map((r) => r[0])).toEqual([indexOf(dilnoza.id)]);
  });
});
