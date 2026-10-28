import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, allocation, grant, mentor, pairing, platformAdmin, program, session, student } from "@/test/db";

/**
 * A mentor's record. What is pinned: who may read it (the mentor, an admin who
 * manages them), that an admin reads only their own programs of it, and that
 * ratings come as a score and a count, never who.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/mentors/[id]/route");
const get = (id: string, query = "") => GET(new Request(`http://test/api/v1/mentors/${id}${query}`), { params: Promise.resolve({ id }) });

/** A mentor in two programs, a student in each, a session and a rating. */
async function scene() {
  const ga = await program("Global Admissions");
  const mp = await program("Master's Program");
  const m = await mentor("Dilnoza Yusupova");
  await pairing({ mentorId: m.id, programId: ga.id });
  await pairing({ mentorId: m.id, programId: mp.id });
  const aziz = await student({ programId: ga.id, name: "Aziz Tursunov" });
  const bek = await student({ programId: mp.id, name: "Bekzod Ergashev" });
  await allocation({ studentId: aziz.id, mentorId: m.id, minutes: 300, deadlineInDays: 10 });
  await allocation({ studentId: bek.id, mentorId: m.id, minutes: 600, deadlineInDays: 40 });
  await session({ studentId: aziz.id, mentorId: m.id, minutes: 60 });
  await prisma.mentorFeedback.create({ data: { studentId: aziz.id, mentorId: m.id, rating: 4, comment: "Aziz says thanks" } });
  return { ga, mp, m, aziz, bek };
}

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/mentors/:id", () => {
  it("answers 401 with no user", async () => expect((await get("x")).status).toBe(401));

  it("gives a mentor their whole record, ratings as a score and a count only", async () => {
    const { m, aziz } = await scene();
    actor.value = { id: m.id };
    const body = await (await get(m.id)).json();
    expect(body).toMatchObject({ self: true, period: "90d", mentor: { id: m.id, name: "Dilnoza Yusupova" } });
    expect(body.programs.map((p: { name: string }) => p.name).sort()).toEqual(["Global Admissions", "Master's Program"]);
    expect(body.time).toEqual({ delivered: 60, missed: 0, sessions: 1 });
    // Soonest use-by first.
    expect(body.students.map((s: { student: { name: string } }) => s.student.name)).toEqual(["Aziz Tursunov", "Bekzod Ergashev"]);
    expect(body.students[0]).toMatchObject({ completed: 60, remaining: 240, allocated: 300, pending: false });
    expect(body.ratings).toEqual({ count: 1, average: 4 });
    expect(JSON.stringify(body.ratings)).not.toContain(aziz.id);
    expect(JSON.stringify(body)).not.toContain("Aziz says thanks");
  });

  it("narrows an admin's read to their own programs", async () => {
    const { ga, m } = await scene();
    const a = await admin("GA Admin");
    await grant({ userId: a.id, programId: ga.id });
    actor.value = { id: a.id };
    const body = await (await get(m.id)).json();
    expect(body.self).toBe(false);
    expect(body.programs.map((p: { name: string }) => p.name)).toEqual(["Global Admissions"]);
    expect(body.students.map((s: { student: { name: string } }) => s.student.name)).toEqual(["Aziz Tursunov"]);
    expect(JSON.stringify(body)).not.toContain("Master");
  });

  it("gives a platform admin every program", async () => {
    const { m } = await scene();
    actor.value = { id: (await platformAdmin()).id };
    expect((await (await get(m.id)).json()).programs).toHaveLength(2);
  });

  it("answers a student, an admin of another program and a colleague as it answers no such mentor", async () => {
    const { m, aziz } = await scene();
    const elsewhere = await admin("Other Admin");
    await grant({ userId: elsewhere.id, programId: (await program("Other")).id });
    const missing = async () => (await get("nobody")).json();
    for (const reader of [aziz.userId, elsewhere.id, (await mentor("Colleague")).id]) {
      actor.value = { id: reader };
      const res = await get(m.id);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(await missing());
    }
  });

  it("reads the period as the page's tabs write it", async () => {
    const { m } = await scene();
    actor.value = { id: m.id };
    expect((await (await get(m.id, "?period=30d")).json()).period).toBe("30d");
    expect((await (await get(m.id, "?period=all")).json()).period).toBe("all");
    expect((await (await get(m.id, "?period=forever")).json()).period).toBe("90d");
  });
});
