import { beforeEach, describe, expect, it, vi } from "vitest";

import { remainingWithMentor } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { admin, allocation, grant, mentor, program, session, student } from "@/test/db";

/**
 * Voiding keeps the row and hands the hours back. The route runs `voidSession`
 * itself, as the signed-in `actor`, against the real database; only
 * `next/cache` is stood in for. A session the person may not see answers like
 * one that was never made, and one they see but may not void is the action's to
 * refuse, in its words.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { POST } = await import("@/app/api/v1/sessions/[id]/void/route");

/** No body unless the test sends one: the route reads none. */
const post = (id: string, body?: string) =>
  POST(new Request("http://test", { method: "POST", body }), { params: Promise.resolve({ id }) });

const stored = (id: string) => prisma.session.findUniqueOrThrow({ where: { id } });

/** A mentor's 60 minutes with a student who was given ten hours with them. */
async function logged(studentStatus?: string) {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id, status: studentStatus });
  const m = await mentor("Akmal Karimov");
  await allocation({ studentId: st.id, mentorId: m.id, minutes: 600 });
  const s = await session({ studentId: st.id, mentorId: m.id, minutes: 60 });
  return { p, st, m, s };
}

beforeEach(() => {
  actor.value = null;
});

describe("POST /api/v1/sessions/:id/void", () => {
  it("answers 401 with no user", async () => expect((await post("x")).status).toBe(401));

  it("answers 403 inactive to an account that isn't active, and voids nothing", async () => {
    const { m, s } = await logged();
    await prisma.user.update({ where: { id: m.id }, data: { status: "PENDING" } });
    actor.value = { id: m.id };
    const res = await post(s.id);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
    expect((await stored(s.id)).status).toBe("ACTIVE");
  });

  it("answers another mentor's session exactly like a missing one, and voids nothing", async () => {
    const { s } = await logged();
    const other = await mentor("Umid Rashidov");
    actor.value = { id: other.id };
    const theirs = await post(s.id);
    const missing = await post("c-made-up");
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect((await stored(s.id)).status).toBe("ACTIVE");
  });

  it("voids the session and gives the hours back", async () => {
    const { p, st, m, s } = await logged();
    actor.value = { id: m.id };
    expect(await remainingWithMentor(st.id, p.id, m.id)).toBe(540);

    const res = await post(s.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "Session voided; hours returned." });
    expect((await stored(s.id)).status).toBe("VOIDED");
    expect(await remainingWithMentor(st.id, p.id, m.id)).toBe(600);
  });

  it("reads no body, so one that makes no sense does no harm", async () => {
    const { m, s } = await logged();
    actor.value = { id: m.id };
    expect((await post(s.id, "{ not json")).status).toBe(200);
    expect((await stored(s.id)).status).toBe("VOIDED");
  });

  it("lets an admin of the program void a session they didn't log", async () => {
    const { p, s } = await logged();
    const boss = await admin("Nodira Aliyeva");
    await grant({ userId: boss.id, programId: p.id });
    actor.value = { id: boss.id };
    expect((await post(s.id)).status).toBe(200);
    expect((await stored(s.id)).status).toBe("VOIDED");
  });

  it("answers a second void in the action's words, for the mentor and for the admin", async () => {
    const { p, m, s } = await logged();
    const boss = await admin("Nodira Aliyeva");
    await grant({ userId: boss.id, programId: p.id });
    await prisma.session.update({ where: { id: s.id }, data: { status: "VOIDED" } });

    actor.value = { id: m.id };
    const byMentor = await post(s.id);
    expect(byMentor.status).toBe(400);
    expect(await byMentor.json()).toEqual({
      ok: false,
      error: "You can only void sessions you logged yourself, and not twice.",
    });

    actor.value = { id: boss.id };
    const byAdmin = await post(s.id);
    expect(byAdmin.status).toBe(400);
    expect(await byAdmin.json()).toEqual({
      ok: false,
      error: "That session is gone, already voided, or isn't in a program you administer.",
    });
  });

  it("answers a student, who reads it but can't void it, in the action's words", async () => {
    const { st, s } = await logged();
    actor.value = { id: st.userId };
    const res = await post(s.id);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "Only the mentor who logged a session, or an admin, can void it.",
    });
    expect((await stored(s.id)).status).toBe("ACTIVE");
  });
});
