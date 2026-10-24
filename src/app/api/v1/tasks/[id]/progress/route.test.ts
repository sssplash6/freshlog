import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { mentor, pairing, program, student, studentTask } from "@/test/db";

/**
 * Moving a task along. It runs `setStudentTaskProgress` itself, as the
 * signed-in `actor`, against the real database.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { POST } = await import("@/app/api/v1/tasks/[id]/progress/route");

/** A JSON body, or a string sent as it is. */
const post = (id: string, body: unknown) =>
  POST(
    new Request("http://test", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) }
  );

const stored = (id: string) => prisma.studentTask.findUniqueOrThrow({ where: { id } });

async function setUp(studentStatus?: string) {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id, status: studentStatus });
  const m = await mentor("Akmal Karimov");
  await pairing({ mentorId: m.id, programId: p.id });
  const t = await studentTask({ studentId: st.id, mentorId: m.id, programId: p.id });
  return { p, st, m, t };
}

beforeEach(() => {
  actor.value = null;
});

describe("POST /api/v1/tasks/:id/progress", () => {
  it("answers 401 with no user", async () => expect((await post("x", { percent: 50 })).status).toBe(401));

  it("answers 403 inactive to an account that isn't active, and changes nothing", async () => {
    const { st, t } = await setUp("PENDING");
    actor.value = { id: st.userId };
    const res = await post(t.id, { percent: 50 });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
    expect((await stored(t.id)).percent).toBe(0);
  });

  it("the student moves their own task to 50; another student's answers 404", async () => {
    const { st, t } = await setUp();
    const other = await student({ name: "Other Student" });
    actor.value = { id: other.userId };
    const theirs = await post(t.id, { percent: 50 });
    const missing = await post("c-made-up", { percent: 50 });
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect((await stored(t.id)).percent).toBe(0);

    actor.value = { id: st.userId };
    const res = await post(t.id, { percent: 50 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect((await stored(t.id)).percent).toBe(50);
  });

  it("finishes a task with done: true, and tells the mentor", async () => {
    const { st, m, t } = await setUp();
    actor.value = { id: st.userId };
    expect((await post(t.id, { done: true })).status).toBe(200);
    const row = await stored(t.id);
    expect(row.percent).toBe(100);
    expect(row.completedAt).not.toBeNull();
    const notices = await prisma.notification.findMany({ where: { type: "TASK_MOVED" } });
    expect(notices.map((n) => n.userId)).toEqual([m.id]);
  });

  it("a percent sent to a finished task reopens it (completedAt null)", async () => {
    const { m, t } = await setUp();
    await prisma.studentTask.update({ where: { id: t.id }, data: { percent: 100, completedAt: new Date() } });
    actor.value = { id: m.id };
    expect((await post(t.id, { percent: 75 })).status).toBe(200);
    expect(await stored(t.id)).toMatchObject({ percent: 75, completedAt: null });
  });

  it("refuses a body with no percent on field \"percent\", and a finished task stays finished", async () => {
    const { m, t } = await setUp();
    await prisma.studentTask.update({ where: { id: t.id }, data: { percent: 100, completedAt: new Date() } });
    actor.value = { id: m.id };
    for (const body of [{}, { percent: "50" }, { percent: 101 }, { done: false }]) {
      const res = await post(t.id, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false, field: "percent" });
    }
    expect((await post(t.id, "not json")).status).toBe(400);
    expect(await stored(t.id)).toMatchObject({ percent: 100 });
    expect((await stored(t.id)).completedAt).not.toBeNull();
  });

  it("refuses a mentor who only reaches the student with 403", async () => {
    const { p, t } = await setUp();
    const colleague = await mentor("Umid Rashidov");
    await pairing({ mentorId: colleague.id, programId: p.id });
    actor.value = { id: colleague.id };
    const res = await post(t.id, { percent: 50 });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: "That task is not yours to change." });
    expect((await stored(t.id)).percent).toBe(0);
  });
});
