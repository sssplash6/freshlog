import { beforeEach, describe, expect, it, vi } from "vitest";

import { remainingWithMentor } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { admin, allocation, grant, mentor, program, session, student } from "@/test/db";

/**
 * Restoring is voiding undone: the session counts again and its hours are
 * charged again. The route runs `restoreSession` itself, as the signed-in
 * `actor`, against the real database; only `next/cache` is stood in for.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { POST } = await import("@/app/api/v1/sessions/[id]/restore/route");

/** No body unless the test sends one: the route reads none. */
const post = (id: string, body?: string) =>
  POST(new Request("http://test", { method: "POST", body }), { params: Promise.resolve({ id }) });

const stored = (id: string) => prisma.session.findUniqueOrThrow({ where: { id } });

/** A mentor's 60 minutes, voided, with a student who was given ten hours with them. */
async function voided() {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id });
  const m = await mentor("Akmal Karimov");
  await allocation({ studentId: st.id, mentorId: m.id, minutes: 600 });
  const s = await session({ studentId: st.id, mentorId: m.id, minutes: 60, status: "VOIDED" });
  return { p, st, m, s };
}

beforeEach(() => {
  actor.value = null;
});

describe("POST /api/v1/sessions/:id/restore", () => {
  it("answers 401 with no user", async () => expect((await post("x")).status).toBe(401));

  it("answers 403 inactive to an account that isn't active, and restores nothing", async () => {
    const { m, s } = await voided();
    await prisma.user.update({ where: { id: m.id }, data: { status: "UNASSIGNED" } });
    actor.value = { id: m.id };
    const res = await post(s.id);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
    expect((await stored(s.id)).status).toBe("VOIDED");
  });

  it("answers another mentor's session exactly like a missing one, and restores nothing", async () => {
    const { s } = await voided();
    const other = await mentor("Umid Rashidov");
    actor.value = { id: other.id };
    const theirs = await post(s.id);
    const missing = await post("c-made-up");
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect((await stored(s.id)).status).toBe("VOIDED");
  });

  it("restores the session and charges the hours again", async () => {
    const { p, st, m, s } = await voided();
    actor.value = { id: m.id };
    expect(await remainingWithMentor(st.id, p.id, m.id)).toBe(600);

    const res = await post(s.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "Session restored; hours charged again." });
    expect((await stored(s.id)).status).toBe("ACTIVE");
    expect(await remainingWithMentor(st.id, p.id, m.id)).toBe(540);
  });

  it("reads no body, so one that makes no sense does no harm", async () => {
    const { m, s } = await voided();
    actor.value = { id: m.id };
    expect((await post(s.id, "{ not json")).status).toBe(200);
    expect((await stored(s.id)).status).toBe("ACTIVE");
  });

  it("lets an admin of the program restore a session they didn't log", async () => {
    const { p, s } = await voided();
    const boss = await admin("Nodira Aliyeva");
    await grant({ userId: boss.id, programId: p.id });
    actor.value = { id: boss.id };
    expect((await post(s.id)).status).toBe(200);
    expect((await stored(s.id)).status).toBe("ACTIVE");
  });

  it("says so, with a 200, when the session is already counting", async () => {
    const { m, s } = await voided();
    await prisma.session.update({ where: { id: s.id }, data: { status: "ACTIVE" } });
    actor.value = { id: m.id };
    const res = await post(s.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "That session is already counting." });
  });

  it("answers a student, who reads it but can't restore it, in the action's words", async () => {
    const { st, s } = await voided();
    actor.value = { id: st.userId };
    const res = await post(s.id);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "Only the mentor who logged a session, or an admin, can restore it.",
    });
    expect((await stored(s.id)).status).toBe("VOIDED");
  });

  // Voiding is how a student is cleared off a program, so a voided session can
  // outlive the membership it was logged under. `can.restore` is false for it
  // (sessions.test.ts), and a restore sent anyway is the action's to refuse.
  it("refuses, in the action's words, a session whose student has left the program", async () => {
    const { st, m, s } = await voided();
    await prisma.studentEnrollment.deleteMany({ where: { studentId: st.id } });
    actor.value = { id: m.id };
    const res = await post(s.id);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "The student is no longer in the program this session was logged in, so it can't be restored.",
    });
    expect((await stored(s.id)).status).toBe("VOIDED");
  });
});
