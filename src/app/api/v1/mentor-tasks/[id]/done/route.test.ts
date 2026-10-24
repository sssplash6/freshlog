import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, DAY, grant, mentor, NOW, program } from "@/test/db";

/**
 * Ticking a mentor task off. The action treats any intent but "done" as "take
 * the tick back", so the route always sends one explicitly and refuses a body
 * that doesn't say which. A share that is not the reader's answers like one that
 * was never made.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { POST } = await import("@/app/api/v1/mentor-tasks/[id]/done/route");

const post = (id: string, body?: unknown) =>
  POST(
    new Request("http://test", {
      method: "POST",
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );

const stored = (id: string) => prisma.mentorTaskAssignee.findUniqueOrThrow({ where: { id } });

/** A task the admin set one mentor, with that mentor's share. */
async function setUp(doneAgo?: number) {
  const p = await program("Global Admissions");
  const a = await admin("Malika Yusupova");
  await grant({ userId: a.id, programId: p.id });
  const m = await mentor("Akmal Karimov");
  const task = await prisma.mentorTask.create({
    data: {
      programId: p.id,
      title: "Read the essays",
      dueOn: new Date(NOW.getTime() + 3 * DAY),
      createdById: a.id,
      assignees: {
        create: {
          mentorId: m.id,
          completedAt: doneAgo === undefined ? null : new Date(NOW.getTime() - doneAgo * DAY),
        },
      },
    },
    include: { assignees: true },
  });
  return { p, a, m, share: task.assignees[0] };
}

beforeEach(() => {
  actor.value = null;
});

describe("POST /api/v1/mentor-tasks/:id/done", () => {
  it("answers 401 with no user", async () => expect((await post("x", { done: true })).status).toBe(401));

  it("answers 403 inactive to an account that isn't active, and ticks nothing", async () => {
    const { m, share } = await setUp();
    await prisma.user.update({ where: { id: m.id }, data: { status: "UNASSIGNED" } });
    actor.value = { id: m.id };
    const res = await post(share.id, { done: true });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
    expect((await stored(share.id)).completedAt).toBeNull();
  });

  it("another mentor's share answers like a missing one, and ticks nothing", async () => {
    const { share } = await setUp();
    const other = await mentor("Umid Rashidov");
    actor.value = { id: other.id };
    const theirs = await post(share.id, { done: true });
    const missing = await post("c-made-up", { done: true });
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect((await stored(share.id)).completedAt).toBeNull();
  });

  it("ticking done stamps completedAt and answers freshform's words", async () => {
    const { m, share } = await setUp();
    actor.value = { id: m.id };
    const res = await post(share.id, { done: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, message: '"Read the essays" is done.' });
    expect((await stored(share.id)).completedAt).not.toBeNull();
  });

  it("ticking done notifies the admin who set it (MENTOR_TASK_DONE)", async () => {
    const { a, m, share } = await setUp();
    actor.value = { id: m.id };
    await post(share.id, { done: true });
    const notes = await prisma.notification.findMany({ where: { userId: a.id, type: "MENTOR_TASK_DONE" } });
    expect(notes).toHaveLength(1);
    expect(notes[0].actorId).toBe(m.id);
  });

  it("{ done: false } sends intent=reopen and clears completedAt", async () => {
    const { a, m, share } = await setUp(1);
    actor.value = { id: m.id };
    const res = await post(share.id, { done: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, message: '"Read the essays" is open again.' });
    expect((await stored(share.id)).completedAt).toBeNull();
    // Taking the tick back is silent.
    await expect(prisma.notification.count({ where: { userId: a.id } })).resolves.toBe(0);
  });

  it("ticking an already done share changes nothing and says so", async () => {
    const { m, share } = await setUp(1);
    const before = (await stored(share.id)).completedAt;
    actor.value = { id: m.id };
    const res = await post(share.id, { done: true });
    expect(await res.json()).toMatchObject({ ok: true, message: "Already done." });
    expect((await stored(share.id)).completedAt).toEqual(before);
  });

  it.each([
    ["{}", {}],
    ["a string", { done: "true" }],
    ["a number", { done: 1 }],
    ["null", { done: null }],
    ["no body", undefined],
    ["text that isn't JSON", "nope"],
  ])("refuses %s with field \"done\", and changes nothing on a done share", async (_name, body) => {
    const { m, share } = await setUp(1);
    const before = (await stored(share.id)).completedAt;
    actor.value = { id: m.id };
    const res = await post(share.id, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, field: "done" });
    expect((await stored(share.id)).completedAt).toEqual(before);
  });
});
