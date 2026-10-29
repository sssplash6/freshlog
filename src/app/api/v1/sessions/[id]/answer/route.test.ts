import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { mentor, program, session, student } from "@/test/db";

/**
 * The student's answer to a session their mentor logged: it happened, or it
 * did not. The route runs `answerSession` itself, as the signed-in `actor`,
 * against the real database; only `next/cache` is stood in for.
 *
 * The mentor sees the session but may not answer for the student, so that is
 * the action's refusal and not a 404.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { POST } = await import("@/app/api/v1/sessions/[id]/answer/route");

/** A JSON body, or a string sent as it is. */
const post = (id: string, body: unknown) =>
  POST(
    new Request("http://test", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) }
  );

const stored = (id: string) => prisma.session.findUniqueOrThrow({ where: { id } });

/** A mentor's 60 minutes with their student, logged for October 22. */
async function logged(studentStatus?: string) {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id, status: studentStatus });
  const m = await mentor("Akmal Karimov");
  const created = await session({ studentId: st.id, mentorId: m.id, minutes: 60 });
  const s = await prisma.session.update({
    where: { id: created.id },
    data: { date: new Date("2026-10-22T00:00:00.000Z") },
  });
  return { p, st, m, s };
}

beforeEach(() => {
  actor.value = null;
});

describe("POST /api/v1/sessions/:id/answer", () => {
  it("answers 401 with no user", async () => expect((await post("x", { answer: "CONFIRMED" })).status).toBe(401));

  it("answers 403 inactive to an account that isn't active, and records nothing", async () => {
    const { st, s } = await logged("PENDING");
    actor.value = { id: st.userId };
    const res = await post(s.id, { answer: "CONFIRMED" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
    expect((await stored(s.id)).studentAnswer).toBeNull();
  });

  it("answers another mentor's session exactly like a missing one", async () => {
    const { s } = await logged();
    const other = await mentor("Umid Rashidov");
    actor.value = { id: other.id };
    const theirs = await post(s.id, { answer: "CONFIRMED" });
    const missing = await post("c-made-up", { answer: "CONFIRMED" });
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect((await stored(s.id)).studentAnswer).toBeNull();
  });

  it("answers another student's session exactly like a missing one", async () => {
    const { p, s } = await logged();
    const other = await student({ programId: p.id, name: "Malika Rahimova" });
    actor.value = { id: other.userId };
    const theirs = await post(s.id, { answer: "CONFIRMED" });
    const missing = await post("c-made-up", { answer: "CONFIRMED" });
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect((await stored(s.id)).studentAnswer).toBeNull();
  });

  it("the student confirms their session", async () => {
    const { st, s } = await logged();
    actor.value = { id: st.userId };

    const res = await post(s.id, { answer: "CONFIRMED" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "Confirmed. Thank you." });
    expect(await stored(s.id)).toMatchObject({ studentAnswer: "CONFIRMED", studentNote: null, studentRating: null });
  });

  it("a confirmation takes the website's stars and its Anything to add, and a dispute keeps no stars", async () => {
    const { st, s } = await logged();
    actor.value = { id: st.userId };
    expect((await post(s.id, { answer: "CONFIRMED", rating: 4, note: "Clear and useful." })).status).toBe(200);
    expect(await stored(s.id)).toMatchObject({ studentAnswer: "CONFIRMED", studentRating: 4, studentNote: "Clear and useful." });
    expect((await post(s.id, { answer: "DISPUTED", rating: 5, note: "It was 30 minutes." })).status).toBe(200);
    expect(await stored(s.id)).toMatchObject({ studentAnswer: "DISPUTED", studentRating: null });
  });

  it("refuses stars that aren't a whole 1 to 5, on rating", async () => {
    const { st, s } = await logged();
    actor.value = { id: st.userId };
    for (const rating of [0, 6, 2.5, "5"]) {
      const res = await post(s.id, { answer: "CONFIRMED", rating });
      expect(res.status).toBe(400);
      expect((await res.json()).field).toBe("rating");
    }
    expect((await stored(s.id)).studentAnswer).toBeNull();
  });

  it("a dispute carries the student's words to the mentor", async () => {
    const { st, m, s } = await logged();
    actor.value = { id: st.userId };

    const res = await post(s.id, { answer: "DISPUTED", note: "It was 30 minutes, not 60." });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      message: "Thank you — your mentor and your program have been told.",
    });
    expect(await stored(s.id)).toMatchObject({ studentAnswer: "DISPUTED", studentNote: "It was 30 minutes, not 60." });
    expect(await prisma.notification.count({ where: { userId: m.id, type: "SESSION_ANSWERED" } })).toBe(1);
  });

  it("a dispute without a note is refused in the action's words", async () => {
    const { st, s } = await logged();
    actor.value = { id: st.userId };
    for (const body of [{ answer: "DISPUTED" }, { answer: "DISPUTED", note: "  " }]) {
      const res = await post(s.id, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "Say what was wrong, so it can be corrected." });
    }
    expect((await stored(s.id)).studentAnswer).toBeNull();
  });

  it("the mentor can't answer for the student", async () => {
    const { m, s } = await logged();
    actor.value = { id: m.id };
    // The mentor sees it, so this is not a 404.
    const res = await post(s.id, { answer: "CONFIRMED" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "That session is not yours." });
    expect((await stored(s.id)).studentAnswer).toBeNull();
  });

  it("answers a voided session in the action's words", async () => {
    const { st, s } = await logged();
    await prisma.session.update({ where: { id: s.id }, data: { status: "VOIDED" } });
    actor.value = { id: st.userId };
    const res = await post(s.id, { answer: "CONFIRMED" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "That session was already corrected — nothing to answer.",
    });
  });

  it.each([
    ["answer", undefined],
    ["answer", "MAYBE"],
    ["answer", "confirmed"],
    ["note", 5],
    ["note", null],
  ])("refuses %s when it is %j, on that field, and records nothing", async (field, value) => {
    const { st, s } = await logged();
    actor.value = { id: st.userId };
    const res = await post(s.id, { answer: "CONFIRMED", [field]: value });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "That isn't a valid value.", field });
    expect((await stored(s.id)).studentAnswer).toBeNull();
  });

  it.each([
    ["text that isn't JSON", "answer=CONFIRMED"],
    ["an array", '["CONFIRMED"]'],
    ["null", "null"],
    ["nothing", ""],
  ])("refuses %s as a whole", async (_, body) => {
    const { st, s } = await logged();
    actor.value = { id: st.userId };
    const res = await post(s.id, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Send the answer as JSON." });
    expect((await stored(s.id)).studentAnswer).toBeNull();
  });

  it("takes no rating, whatever the body says", async () => {
    const { st, s } = await logged();
    actor.value = { id: st.userId };
    expect((await post(s.id, { answer: "CONFIRMED", studentRating: 5 })).status).toBe(200);
    expect((await stored(s.id)).studentRating).toBeNull();
  });
});
