import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { mentor, pairing, program, student, studentTask } from "@/test/db";

/**
 * One task, to the people it belongs to. Anybody else's answers exactly like an
 * id that was never made, so the answer cannot be used to find out which tasks
 * exist.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { DELETE, GET, PATCH } = await import("@/app/api/v1/tasks/[id]/route");

const get = (id: string) => GET(new Request("http://test"), { params: Promise.resolve({ id }) });

/** A JSON body, or a string sent as it is. */
const patch = (id: string, body: unknown) =>
  PATCH(
    new Request("http://test", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) }
  );

const del = (id: string) => DELETE(new Request("http://test", { method: "DELETE" }), { params: Promise.resolve({ id }) });

/** What is stored. */
const stored = (id: string) => prisma.studentTask.findUnique({ where: { id } });

/** A student's task, set by their mentor, due 2026-11-03. */
async function setUp(studentStatus?: string) {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id, status: studentStatus });
  const m = await mentor("Akmal Karimov");
  await pairing({ mentorId: m.id, programId: p.id });
  const t = await studentTask({ studentId: st.id, mentorId: m.id, programId: p.id });
  await prisma.studentTask.update({ where: { id: t.id }, data: { dueOn: new Date("2026-11-03T00:00:00.000Z") } });
  return { p, st, m, t };
}

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/tasks/:id", () => {
  it("answers 401 with no user", async () => expect((await get("x")).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    const { st, t } = await setUp("PENDING");
    actor.value = { id: st.userId };
    const res = await get(t.id);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("another student's task answers like a missing one", async () => {
    const { t } = await setUp();
    const other = await student({ name: "Other Student" });
    actor.value = { id: other.userId };
    const theirs = await get(t.id);
    const missing = await get("c-made-up");
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
  });

  it("answers the student with the task and the program's today", async () => {
    const { st, t } = await setUp();
    actor.value = { id: st.userId };
    const res = await get(t.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      task: { id: t.id, due: "2026-11-03", percent: 0, can: { progress: true, edit: false, delete: false } },
    });
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("PATCH /api/v1/tasks/:id", () => {
  it("answers 401 with no user", async () => expect((await patch("x", { title: "A" })).status).toBe(401));

  it("answers 403 inactive to an account that isn't active, and changes nothing", async () => {
    const { m, t } = await setUp();
    await prisma.user.update({ where: { id: m.id }, data: { status: "PENDING" } });
    actor.value = { id: m.id };
    const res = await patch(t.id, { title: "New" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
    expect((await stored(t.id))?.title).toBe("Rewrite the draft");
  });

  it("answers another student's task exactly like a missing one, and changes nothing", async () => {
    const { t } = await setUp();
    const other = await student({ name: "Other Student" });
    actor.value = { id: other.userId };
    const theirs = await patch(t.id, { title: "New" });
    const missing = await patch("c-made-up", { title: "New" });
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect((await stored(t.id))?.title).toBe("Rewrite the draft");
  });

  it("changes only what it is sent, and tells the student", async () => {
    const { st, m, t } = await setUp();
    await prisma.studentTask.update({ where: { id: t.id }, data: { note: "Start with the intro.", percent: 50 } });
    actor.value = { id: m.id };

    const res = await patch(t.id, { title: "Rewrite the essay" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    const row = await stored(t.id);
    expect(row).toMatchObject({ title: "Rewrite the essay", note: "Start with the intro.", percent: 50 });
    expect(row?.dueOn.toISOString()).toBe("2026-11-03T00:00:00.000Z");
    const notices = await prisma.notification.findMany({ where: { type: "TASK_CHANGED" } });
    expect(notices.map((n) => n.userId)).toEqual([st.userId]);
  });

  it("moves the day, and null clears the note", async () => {
    const { m, t } = await setUp();
    await prisma.studentTask.update({ where: { id: t.id }, data: { note: "Start with the intro." } });
    actor.value = { id: m.id };
    expect((await patch(t.id, { due: "2026-11-10", note: null })).status).toBe(200);
    const row = await stored(t.id);
    expect(row?.note).toBeNull();
    expect(row?.dueOn.toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });

  it("refuses 2026-02-31 on field \"due\" and changes nothing", async () => {
    const { m, t } = await setUp();
    actor.value = { id: m.id };
    const res = await patch(t.id, { due: "2026-02-31" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, field: "due" });
    expect((await stored(t.id))?.dueOn.toISOString()).toBe("2026-11-03T00:00:00.000Z");
  });

  it("refuses a body that is not an object, and a value of the wrong type", async () => {
    const { m, t } = await setUp();
    actor.value = { id: m.id };
    expect((await patch(t.id, "not json")).status).toBe(400);
    const res = await patch(t.id, { title: 5 });
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("title");
  });

  it("refuses a student, who can read the task but not change it, with 403 in freshform's words", async () => {
    const { st, t } = await setUp();
    actor.value = { id: st.userId };
    const res = await patch(t.id, { title: "Mine now" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: "That task is not yours to change." });
    expect((await stored(t.id))?.title).toBe("Rewrite the draft");
  });

  it("refuses a mentor who reaches the student but does not own the task, and changes nothing", async () => {
    const { p, t } = await setUp();
    const colleague = await mentor("Umid Rashidov");
    await pairing({ mentorId: colleague.id, programId: p.id });
    actor.value = { id: colleague.id };
    const res = await patch(t.id, { title: "Mine now" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: "That task is not yours to change." });
    expect((await stored(t.id))?.title).toBe("Rewrite the draft");
  });

  it("refuses a whitespace-only title on field \"title\"", async () => {
    const { m, t } = await setUp();
    actor.value = { id: m.id };
    const res = await patch(t.id, { title: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("title");
    expect((await stored(t.id))?.title).toBe("Rewrite the draft");
  });
});

describe("DELETE /api/v1/tasks/:id", () => {
  it("answers 401 with no user", async () => expect((await del("x")).status).toBe(401));

  it("answers 403 inactive to an account that isn't active, and deletes nothing", async () => {
    const { m, t } = await setUp();
    await prisma.user.update({ where: { id: m.id }, data: { status: "PENDING" } });
    actor.value = { id: m.id };
    const res = await del(t.id);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
    expect(await stored(t.id)).not.toBeNull();
  });

  it("answers another student's task exactly like a missing one, and deletes nothing", async () => {
    const { t } = await setUp();
    const other = await student({ name: "Other Student" });
    actor.value = { id: other.userId };
    const theirs = await del(t.id);
    const missing = await del("c-made-up");
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect(await stored(t.id)).not.toBeNull();
  });

  it("refuses a student, who can read the task but not delete it, with 403", async () => {
    const { st, t } = await setUp();
    actor.value = { id: st.userId };
    const res = await del(t.id);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: "That task is not yours to change." });
    expect(await stored(t.id)).not.toBeNull();
  });

  it("the owning mentor deletes it; a mentor who only reaches the student is refused in freshform's words", async () => {
    const { p, st, m, t } = await setUp();
    const colleague = await mentor("Umid Rashidov");
    await pairing({ mentorId: colleague.id, programId: p.id });

    actor.value = { id: colleague.id };
    const refused = await del(t.id);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ ok: false, error: "That task is not yours to change." });
    expect(await stored(t.id)).not.toBeNull();

    actor.value = { id: m.id };
    const res = await del(t.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(await stored(t.id)).toBeNull();
    const notices = await prisma.notification.findMany({ where: { type: "TASK_CHANGED" } });
    expect(notices.map((n) => n.userId)).toEqual([st.userId]);
  });
});
