import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, grant, mentor, pairing, platformAdmin, program, student } from "@/test/db";

/**
 * The Ratings page and the Mentors list. What is pinned: who reads which, that a
 * student's name goes only to that student's admins, and that a mentor reading
 * their own never learns who wrote what.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const ratings = await import("@/app/api/v1/ratings/route");
const mentors = await import("@/app/api/v1/mentors/route");
const getRatings = (query = "") => ratings.GET(new Request(`http://test/api/v1/ratings${query}`));
const getMentors = (query = "") => mentors.GET(new Request(`http://test/api/v1/mentors${query}`));

async function scene() {
  const ga = await program("Global Admissions");
  const other = await program("Other Program");
  const low = await mentor("Akmal Low");
  const high = await mentor("Dilnoza High");
  await pairing({ mentorId: low.id, programId: ga.id });
  await pairing({ mentorId: high.id, programId: ga.id });
  const aziz = await student({ programId: ga.id, name: "Aziz Tursunov" });
  const elsewhere = await student({ programId: other.id, name: "Zara Elsewhere" });
  await prisma.mentorFeedback.create({ data: { studentId: aziz.id, mentorId: low.id, rating: 2, comment: "Late." } });
  await prisma.mentorFeedback.create({ data: { studentId: aziz.id, mentorId: high.id, rating: 5, comment: "Great." } });
  await prisma.mentorFeedback.create({ data: { studentId: elsewhere.id, mentorId: high.id, rating: 1, comment: "Zara's words" } });
  return { ga, other, low, high, aziz };
}

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/ratings", () => {
  it("answers 401 with no user, and 404 to a student", async () => {
    expect((await getRatings()).status).toBe(401);
    const s = await student();
    actor.value = { id: s.userId };
    expect((await getRatings()).status).toBe(404);
  });

  it("gives a program admin their program's ratings, worst first, naming their own students", async () => {
    const { ga, low, high } = await scene();
    const a = await admin();
    await grant({ userId: a.id, programId: ga.id });
    actor.value = { id: a.id };
    const body = await (await getRatings()).json();
    expect(body).toMatchObject({ kind: "staff", count: 2 });
    expect(body.mentors.map((m: { mentor: { id: string } }) => m.mentor.id)).toEqual([low.id, high.id]);
    expect(body.mentors[0]).toMatchObject({ average: 2, count: 1, low: true });
    expect(body.ratings.every((r: { student: { name: string } | null }) => r.student?.name === "Aziz Tursunov")).toBe(true);
    // Another program's student's rating is not this reader's to read.
    expect(JSON.stringify(body)).not.toContain("Zara");
  });

  it("gives a leader the ratings but names no student", async () => {
    const { ga } = await scene();
    const l = await admin("Leader");
    await grant({ userId: l.id, programId: ga.id, role: "LEADER" });
    actor.value = { id: l.id };
    const body = await (await getRatings()).json();
    expect(body.count).toBe(2);
    expect(body.ratings.every((r: { student: unknown }) => r.student === null)).toBe(true);
  });

  it("gives a mentor their own, with nobody named", async () => {
    const { high } = await scene();
    actor.value = { id: high.id };
    const body = await (await getRatings()).json();
    expect(body).toMatchObject({ kind: "own", count: 2, average: 3 });
    expect(JSON.stringify(body)).not.toContain("Aziz");
    expect(JSON.stringify(body)).not.toContain("Zara Elsewhere");
    expect(body.ratings.every((r: { student: unknown; mentor: unknown }) => r.student === null && r.mentor === null)).toBe(true);
  });

  it("filters by mentor", async () => {
    const { low } = await scene();
    actor.value = { id: (await platformAdmin()).id };
    const body = await (await getRatings(`?mentor=${low.id}`)).json();
    expect(body.ratings.map((r: { comment: string }) => r.comment)).toEqual(["Late."]);
  });
});

describe("GET /api/v1/mentors", () => {
  it("answers 404 to someone with no admin grant", async () => {
    actor.value = { id: (await mentor()).id };
    expect((await getMentors()).status).toBe(404);
  });

  it("lists the mentors in the reader's programs, with their figures there", async () => {
    const { ga, other, high } = await scene();
    await pairing({ mentorId: high.id, programId: other.id });
    const lonely = await mentor("Nobody Placed");
    const a = await admin();
    await grant({ userId: a.id, programId: ga.id });
    actor.value = { id: a.id };
    const body = await (await getMentors()).json();
    expect(body.rows.map((r: { mentor: { name: string } }) => r.mentor.name).sort()).toEqual(["Akmal Low", "Dilnoza High"]);
    const dilnoza = body.rows.find((r: { mentor: { id: string } }) => r.mentor.id === high.id);
    expect(dilnoza.programs.map((p: { label: string }) => p.label)).toEqual(["Global Admissions"]);
    expect(dilnoza.rating).toEqual({ average: 5, count: 1 });
    expect(JSON.stringify(body)).not.toContain(lonely.id);
    expect(body).toMatchObject({ total: 2, roster: 2, page: 1, pageSize: 25 });
  });
});
