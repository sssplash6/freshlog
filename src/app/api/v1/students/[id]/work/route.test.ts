import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, assignment, enroll, grant, mentor, pairing, program, student, studentTask } from "@/test/db";

/**
 * One student's work, to the staff who may read them. Anybody else's answers
 * exactly like a student who was never made.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/students/[id]/work/route");

const get = (id: string) => GET(new Request("http://test"), { params: Promise.resolve({ id }) });

async function setUp() {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id, name: "Aziz Karimov" });
  const m = await mentor("Akmal Karimov");
  await pairing({ mentorId: m.id, programId: p.id });
  const t = await studentTask({ studentId: st.id, mentorId: m.id });
  return { p, st, m, t };
}

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/students/:id/work", () => {
  it("answers 401 with no user", async () => expect((await get("x")).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    const { st, m } = await setUp();
    await prisma.user.update({ where: { id: m.id }, data: { status: "SUSPENDED" } });
    actor.value = { id: m.id };
    const res = await get(st.id);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("a student nobody here reaches answers like a missing one", async () => {
    const { st } = await setUp();
    const stranger = await mentor("Nobody");
    actor.value = { id: stranger.id };
    const theirs = await get(st.id);
    const missing = await get("c-made-up");
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
  });

  it("answers the mentor with the student's work", async () => {
    const { p, st, m, t } = await setUp();
    actor.value = { id: m.id };
    const res = await get(st.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      student: { id: st.id },
      tasks: [{ id: t.id, can: { edit: true } }],
      plan: [],
      canSetTaskIn: [{ id: p.id, name: "Global Admissions" }],
    });
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // A student in two programs, a row in each, and a mentor whose pairing is in the second.
  async function twoPrograms() {
    const first = await program("Global Admissions");
    const second = await program("Master's Program");
    const st = await student({ programId: first.id, name: "Aziz Karimov" });
    await enroll({ studentId: st.id, programId: second.id });
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: second.id });
    const inFirst = await studentTask({ studentId: st.id, mentorId: m.id, programId: first.id, title: "First task" });
    const inSecond = await studentTask({ studentId: st.id, mentorId: m.id, programId: second.id, title: "Second task" });
    const planFirst = await assignment({ studentId: st.id, programId: first.id, mentorId: m.id, purpose: "First plan" });
    const planSecond = await assignment({ studentId: st.id, programId: second.id, mentorId: m.id, purpose: "Second plan" });
    return { first, second, st, m, inFirst, inSecond, planFirst, planSecond };
  }

  it("an admin of one of two programs sees only that program's rows, and no trace of the other", async () => {
    const { first, second, st, inFirst, planFirst } = await twoPrograms();
    const a = await admin("Dilnoza");
    await grant({ userId: a.id, programId: first.id });
    actor.value = { id: a.id };
    const res = await get(st.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks.map((t: { id: string }) => t.id)).toEqual([inFirst.id]);
    expect(body.plan.map((i: { id: string }) => i.id)).toEqual([planFirst.id]);
    expect(body.canSetTaskIn.map((x: { id: string }) => x.id)).toEqual([first.id]);
    const text = JSON.stringify(body);
    expect(text).not.toContain(second.name);
    expect(text).not.toContain("Second");
  });

  it("an admin who also mentors stays scoped to the programs they administer", async () => {
    const { first, second, st, inFirst, planFirst } = await twoPrograms();
    // Admin of the first program, and a mentor paired in the second, where the student also studies.
    const both = await admin("Admin Mentor");
    await prisma.user.update({ where: { id: both.id }, data: { isMentor: true } });
    await grant({ userId: both.id, programId: first.id });
    await pairing({ mentorId: both.id, programId: second.id });
    actor.value = { id: both.id };
    const body = await (await get(st.id)).json();
    expect(body.tasks.map((t: { id: string }) => t.id)).toEqual([inFirst.id]);
    expect(body.plan.map((i: { id: string }) => i.id)).toEqual([planFirst.id]);
    expect(body.canSetTaskIn.map((x: { id: string }) => x.id)).toEqual([first.id]);
    expect(JSON.stringify(body)).not.toContain(second.name);
  });

  it("a student who administers their program reads their own page without the staff note", async () => {
    const p = await program("Global Admissions");
    const st = await student({ programId: p.id, name: "Aziz Karimov" });
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: p.id });
    const item = await assignment({ studentId: st.id, mentorId: m.id, purpose: "Essay" });
    await prisma.assignment.update({ where: { id: item.id }, data: { note: "Staff note" } });
    await grant({ userId: st.userId, programId: p.id });
    actor.value = { id: st.userId };
    const res = await get(st.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toMatchObject([{ id: item.id, note: null }]);
    expect(JSON.stringify(body)).not.toContain("Staff note");
  });
});
