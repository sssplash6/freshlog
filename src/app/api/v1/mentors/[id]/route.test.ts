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

  it("takes the Custom tab's typed range, and says the window as the page does", async () => {
    const { m } = await scene();
    actor.value = { id: m.id };
    const body = await (await get(m.id, "?from=2026-01-01&to=2026-01-31")).json();
    expect(body.period).toBe("custom");
    expect(body.window).toMatchObject({ from: "2026-01-01", to: "2026-01-31" });
    // Nothing happened then, so the period's figures are empty; the program table is the ledger, whatever the window.
    expect(body.time).toEqual({ delivered: 0, missed: 0, sessions: 0 });
    expect(body.recent).toEqual([]);
    expect(body.programTable.find((r: { program: { name: string } }) => r.program.name === "Global Admissions")).toMatchObject({ completed: 60, total: 300 });
  });

  it("has the page's table per program, counting a student in two programs twice", async () => {
    const { ga, mp, m, aziz } = await scene();
    await prisma.studentEnrollment.create({ data: { studentId: aziz.id, programId: mp.id } });
    await allocation({ studentId: aziz.id, programId: mp.id, mentorId: m.id, minutes: 120, deadlineInDays: 20 });
    actor.value = { id: m.id };
    const body = await (await get(m.id)).json();
    const row = (id: string) => body.programTable.find((r: { program: { id: string } }) => r.program.id === id);
    expect(row(ga.id)).toMatchObject({ students: 1, completed: 60, remaining: 240, total: 300 });
    expect(row(mp.id)).toMatchObject({ students: 2, completed: 0, total: 720 });
    expect(body.programTable.reduce((n: number, r: { students: number }) => n + r.students, 0)).toBe(3);
  });

  it("lists the period's ten newest sessions as sessions, with how many it holds", async () => {
    const { m, aziz } = await scene();
    for (let i = 0; i < 11; i++) await session({ studentId: aziz.id, mentorId: m.id, minutes: 30 });
    actor.value = { id: m.id };
    const body = await (await get(m.id)).json();
    expect(body.sessionCount).toBe(12);
    expect(body.recent).toHaveLength(10);
    expect(body.recent[0]).toMatchObject({ mentor: { id: m.id }, student: { name: "Aziz Tursunov" }, statuses: expect.any(Array) });
  });

  it("shows an admin a program the mentor works in where nothing has happened yet as an idle row", async () => {
    const { ga, m } = await scene();
    const quiet = await program("Imkon");
    await pairing({ mentorId: m.id, programId: quiet.id });
    actor.value = { id: (await platformAdmin()).id };
    const body = await (await get(m.id)).json();
    expect(body.programTable.find((r: { program: { id: string } }) => r.program.id === quiet.id)).toMatchObject({ idle: true, students: 0 });
    expect(body.programTable.find((r: { program: { id: string } }) => r.program.id === ga.id).idle).toBeUndefined();
  });
});
