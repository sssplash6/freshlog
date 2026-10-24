import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, assignment, grant, mentor, pairing, program, student } from "@/test/db";

/**
 * Setting a plan item's progress runs `setAssignmentProgress`, the action the
 * website's one-click control calls, as the signed-in `actor` against the real
 * database; only `next/cache` is stood in for.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { POST } = await import("@/app/api/v1/plan-items/[id]/progress/route");

const post = (id: string, body: unknown) =>
  POST(
    new Request("http://test", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) }
  );

const stored = (id: string) => prisma.assignment.findUniqueOrThrow({ where: { id } });

async function setUp(studentStatus?: string) {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id, status: studentStatus });
  const m = await mentor("Akmal Karimov");
  await pairing({ mentorId: m.id, programId: p.id });
  const a = await assignment({ studentId: st.id, programId: p.id, mentorId: m.id, purpose: "Personal statement" });
  return { p, st, m, a };
}

beforeEach(() => {
  actor.value = null;
});

describe("POST /api/v1/plan-items/:id/progress", () => {
  it("answers 401 with no user", async () => expect((await post("x", { progress: "DONE" })).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    const { st, a } = await setUp("PENDING");
    actor.value = { id: st.userId };
    const res = await post(a.id, { progress: "DONE" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("another mentor's plan item answers like a missing one", async () => {
    const { a } = await setUp();
    actor.value = { id: (await mentor("Umid Rashidov")).id };
    const theirs = await post(a.id, { progress: "DONE" });
    const missing = await post("c-made-up", { progress: "DONE" });
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect((await stored(a.id)).progress).not.toBe("DONE");
  });

  it("the item's own student can read it but not move it: 403, nothing saved", async () => {
    const { st, a } = await setUp();
    actor.value = { id: st.userId };
    const res = await post(a.id, { progress: "DONE" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("That plan item is not yours to change.");
    expect(await stored(a.id)).toMatchObject({ progress: "NOT_STARTED", progressManual: false });
  });

  it("a co-mentor who reaches the student can read it but not move it: 403, nothing saved", async () => {
    const { p, a } = await setUp();
    const co = await mentor("Umid Rashidov");
    await pairing({ mentorId: co.id, programId: p.id });
    actor.value = { id: co.id };
    const res = await post(a.id, { progress: "AUTO" });
    expect(res.status).toBe(403);
    expect((await post(a.id, { progress: "DONE" })).status).toBe(403);
    expect(await stored(a.id)).toMatchObject({ progress: "NOT_STARTED", progressManual: false });
  });

  it("the owning mentor pins it to the state they name", async () => {
    const { m, a } = await setUp();
    actor.value = { id: m.id };
    const res = await post(a.id, { progress: "DONE" });
    expect(res.status).toBe(200);
    expect(await stored(a.id)).toMatchObject({ progress: "DONE", progressManual: true });
  });

  it("an admin of the item's program may too", async () => {
    const { p, a } = await setUp();
    const boss = await admin("Program Admin");
    await grant({ userId: boss.id, programId: p.id });
    actor.value = { id: boss.id };
    expect((await post(a.id, { progress: "IN_PROGRESS" })).status).toBe(200);
    expect(await stored(a.id)).toMatchObject({ progress: "IN_PROGRESS", progressManual: true });
  });

  it("AUTO on a pinned item lets it follow its hours again (pinned false)", async () => {
    const { m, a } = await setUp();
    await prisma.assignment.update({ where: { id: a.id }, data: { progress: "DONE", progressManual: true } });
    actor.value = { id: m.id };
    const res = await post(a.id, { progress: "AUTO" });
    expect(res.status).toBe(200);
    const row = await stored(a.id);
    expect(row.progressManual).toBe(false);
    // No hours were logged and it has no limit, so the hours say it has not begun.
    expect(row.progress).toBe("NOT_STARTED");
  });

  it("AUTO on an item that is not pinned changes nothing", async () => {
    const { m, a } = await setUp();
    actor.value = { id: m.id };
    const res = await post(a.id, { progress: "AUTO" });
    expect(res.status).toBe(200);
    expect(await stored(a.id)).toMatchObject({ progress: "NOT_STARTED", progressManual: false });
  });

  it('refuses "PAUSED" with field "progress", and a body with no progress', async () => {
    const { m, a } = await setUp();
    actor.value = { id: m.id };
    for (const body of [{ progress: "PAUSED" }, {}, "nope"]) {
      const res = await post(a.id, body);
      expect(res.status).toBe(400);
      if (typeof body === "object") expect((await res.json()).field).toBe("progress");
    }
    expect((await stored(a.id)).progressManual).toBe(false);
  });
});
