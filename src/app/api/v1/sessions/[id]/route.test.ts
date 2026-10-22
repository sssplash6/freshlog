import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, assignment, grant, mentor, program, session, student } from "@/test/db";

/**
 * One session, to the people it belongs to. Anybody else's answers exactly like
 * an id that was never made, so the answer cannot be used to find out which
 * sessions exist.
 *
 * PATCH runs `editSession` itself, as the signed-in `actor`, against the real
 * database; only `next/cache` is stood in for.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET, PATCH } = await import("@/app/api/v1/sessions/[id]/route");

const get = (id: string) => GET(new Request("http://test"), { params: Promise.resolve({ id }) });

/** A JSON body, or a string sent as it is. */
const patch = (id: string, body: unknown) =>
  PATCH(
    new Request("http://test", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) }
  );

/** What is stored, whoever may read it. */
const stored = (id: string) => prisma.session.findUniqueOrThrow({ where: { id } });

/** A mentor's session with their student, logged for October 22. */
async function logged(studentStatus?: string) {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id, status: studentStatus });
  const m = await mentor("Akmal Karimov");
  const created = await session({ studentId: st.id, mentorId: m.id, minutes: 60 });
  const s = await prisma.session.update({
    where: { id: created.id },
    data: { date: new Date("2026-10-22T00:00:00.000Z") },
  });
  return { st, m, s };
}

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/sessions/:id", () => {
  it("answers 401 with no user", async () => expect((await get("x")).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    // Even about a session of their own: the gate turns them away before
    // anything is read.
    const { st, s } = await logged("PENDING");
    actor.value = { id: st.userId };
    const res = await get(s.id);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("answers another mentor's session exactly like a missing one", async () => {
    const { s } = await logged();
    const other = await mentor("Umid Rashidov");
    actor.value = { id: other.id };
    const theirs = await get(s.id);
    const missing = await get("c-made-up");
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
  });

  it("answers the mentor with the session", async () => {
    const { m, s } = await logged();
    actor.value = { id: m.id };
    const res = await get(s.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: s.id, day: "2026-10-22", can: { edit: true } });
  });
});

describe("PATCH /api/v1/sessions/:id", () => {
  it("answers 401 with no user", async () => expect((await patch("x", { minutes: 45 })).status).toBe(401));

  it("answers 403 inactive to an account that isn't active, and changes nothing", async () => {
    const { m, s } = await logged();
    await prisma.user.update({ where: { id: m.id }, data: { status: "UNASSIGNED" } });
    actor.value = { id: m.id };
    const res = await patch(s.id, { minutes: 45 });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
    expect((await stored(s.id)).minutes).toBe(60);
  });

  it("answers another mentor's session exactly like a missing one, and changes nothing", async () => {
    const { s } = await logged();
    const other = await mentor("Umid Rashidov");
    actor.value = { id: other.id };
    const theirs = await patch(s.id, { minutes: 45 });
    const missing = await patch("c-made-up", { minutes: 45 });
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect((await stored(s.id)).minutes).toBe(60);
  });

  it("changes only what it is sent", async () => {
    const { m, s } = await logged();
    await prisma.session.update({
      where: { id: s.id },
      data: { late: true, withinPlan: false, note: "Went through the essay." },
    });
    actor.value = { id: m.id };

    const res = await patch(s.id, { minutes: 45 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "Session updated." });
    expect(await (await get(s.id)).json()).toMatchObject({
      day: "2026-10-22",
      minutes: 45,
      attendance: "LATE",
      kind: "EXTRA",
      note: "Went through the essay.",
      state: "ACTIVE",
    });
  });

  it("changes every field it is sent", async () => {
    const { st, m, s } = await logged();
    await prisma.session.update({
      where: { id: s.id },
      data: { late: true, withinPlan: false, note: "Went through the essay." },
    });
    const task = await assignment({ studentId: st.id, mentorId: m.id, purpose: "Main essay" });
    actor.value = { id: m.id };

    const res = await patch(s.id, {
      day: "2026-10-21",
      minutes: 30,
      attendance: "ABSENT",
      kind: "PLAN",
      note: "Did not come.",
      assignmentId: task.id,
    });

    expect(res.status).toBe(200);
    expect(await (await get(s.id)).json()).toMatchObject({
      day: "2026-10-21",
      minutes: 30,
      attendance: "ABSENT",
      kind: "PLAN",
      charged: true,
      note: "Did not come.",
      task: { id: task.id, purpose: "Main essay" },
    });
  });

  it.each([[null], [""]])("clears the note when it is sent %j", async (note) => {
    const { m, s } = await logged();
    await prisma.session.update({ where: { id: s.id }, data: { note: "Went through the essay." } });
    actor.value = { id: m.id };
    expect((await patch(s.id, { note })).status).toBe(200);
    expect(await (await get(s.id)).json()).toMatchObject({ note: null, minutes: 60 });
  });

  it("keeps the plan item a session has when the edit names none, and moves it when it names another", async () => {
    const { st, m, s } = await logged();
    const first = await assignment({ studentId: st.id, mentorId: m.id, purpose: "Main essay" });
    const second = await assignment({ studentId: st.id, mentorId: m.id, purpose: "Interview prep" });
    await prisma.session.update({ where: { id: s.id }, data: { assignmentId: first.id } });
    actor.value = { id: m.id };

    expect((await patch(s.id, { minutes: 45 })).status).toBe(200);
    expect((await (await get(s.id)).json()).task).toEqual({ id: first.id, purpose: "Main essay" });

    expect((await patch(s.id, { assignmentId: second.id })).status).toBe(200);
    expect((await (await get(s.id)).json()).task).toEqual({ id: second.id, purpose: "Interview prep" });
  });

  it("refuses minutes that aren't a number, on minutes", async () => {
    const { m, s } = await logged();
    actor.value = { id: m.id };
    const res = await patch(s.id, { minutes: "lots" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "That isn't a valid value.", field: "minutes" });
    expect((await stored(s.id)).minutes).toBe(60);
  });

  // The action would turn an attendance or a kind it doesn't know into Attended
  // and Plan, and save it: a typo would rewrite a session without a word.
  it.each([
    ["attendance", "SKIPPED"],
    ["attendance", "late"],
    ["kind", "FREE"],
    ["day", 20261021],
    ["note", 5],
    ["assignmentId", 7],
  ])("refuses %s when it is %j, on that field, and changes nothing", async (field, value) => {
    const { m, s } = await logged();
    await prisma.session.update({ where: { id: s.id }, data: { late: true, withinPlan: false } });
    actor.value = { id: m.id };
    const res = await patch(s.id, { [field]: value });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "That isn't a valid value.", field });
    expect(await stored(s.id)).toMatchObject({ late: true, withinPlan: false, minutes: 60 });
  });

  it.each([
    ["text that isn't JSON", "minutes=45"],
    ["an array", "[45]"],
    ["null", "null"],
    ["nothing", ""],
  ])("refuses %s as a whole", async (_, body) => {
    const { m, s } = await logged();
    actor.value = { id: m.id };
    const res = await patch(s.id, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Send the changes as JSON." });
    expect((await stored(s.id)).minutes).toBe(60);
  });

  // What a value says is the action's to judge, in the website's words, and
  // with no field: the route only refuses a value of the wrong type.
  it.each([
    [{ minutes: 1.5 }, "Minutes must be whole minutes — 90, not 1.5."],
    [{ minutes: 0 }, "Minutes must be at least 0.01."],
    [{ day: "next week" }, "Pick a valid date."],
    [{ day: "2999-01-01" }, "A session can't be dated in the future. Pick today or an earlier day."],
  ])("leaves %j to the action", async (body, error) => {
    const { m, s } = await logged();
    actor.value = { id: m.id };
    const res = await patch(s.id, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error });
    expect(await stored(s.id)).toMatchObject({ minutes: 60 });
  });

  it("changes the session in the address, whatever else the body names", async () => {
    const { st, m, s } = await logged();
    const other = await session({ studentId: st.id, mentorId: m.id, minutes: 30 });
    const stranger = await mentor("Umid Rashidov");
    actor.value = { id: m.id };
    const res = await patch(s.id, { minutes: 45, sessionId: other.id, mentorId: stranger.id });
    expect(res.status).toBe(200);
    expect(await stored(s.id)).toMatchObject({ minutes: 45, mentorId: m.id });
    expect(await stored(other.id)).toMatchObject({ minutes: 30, mentorId: m.id });
  });

  it("lets an admin of the program correct a session they didn't log", async () => {
    const { m, s } = await logged();
    const boss = await admin("Nodira Aliyeva");
    await grant({ userId: boss.id, programId: s.programId });
    actor.value = { id: boss.id };
    const res = await patch(s.id, { minutes: 45 });
    expect(res.status).toBe(200);
    expect(await stored(s.id)).toMatchObject({ minutes: 45, mentorId: m.id });
  });

  // They may edit their own session, and are shown no note: the mentor's
  // write-up is not for the student it is about, even one who administers the
  // program. So the note an edit leaves out cannot come from what they were shown.
  it("a student who administers the program keeps the mentor's note when they edit", async () => {
    const { st, s } = await logged();
    await prisma.session.update({ where: { id: s.id }, data: { note: "Went through the essay." } });
    await grant({ userId: st.userId, programId: s.programId, role: "ADMIN" });
    actor.value = { id: st.userId };
    expect(await (await get(s.id)).json()).toMatchObject({ note: null, can: { edit: true } });

    const res = await patch(s.id, { minutes: 45 });

    expect(res.status).toBe(200);
    // The note stays on the server: the answer is the sentence and nothing the action saved.
    expect(await res.json()).toEqual({ ok: true, message: "Session updated." });
    expect(await stored(s.id)).toMatchObject({ minutes: 45, note: "Went through the essay." });
  });

  it("a student who runs the platform keeps the mentor's note when they edit", async () => {
    const { st, s } = await logged();
    await prisma.session.update({ where: { id: s.id }, data: { note: "Went through the essay." } });
    await prisma.user.update({ where: { id: st.userId }, data: { platformAdmin: true } });
    actor.value = { id: st.userId };
    expect(await (await get(s.id)).json()).toMatchObject({ note: null, can: { edit: true } });

    const res = await patch(s.id, { minutes: 45 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "Session updated." });
    expect(await stored(s.id)).toMatchObject({ minutes: 45, note: "Went through the essay." });
  });

  it("lets a student who administers the program write a note of their own over the mentor's", async () => {
    const { st, s } = await logged();
    await prisma.session.update({ where: { id: s.id }, data: { note: "Went through the essay." } });
    await grant({ userId: st.userId, programId: s.programId, role: "ADMIN" });
    actor.value = { id: st.userId };
    expect((await patch(s.id, { note: "Corrected after the call." })).status).toBe(200);
    expect((await stored(s.id)).note).toBe("Corrected after the call.");
  });

  it("answers a student, who reads it but can't change it, in the action's words", async () => {
    const { st, s } = await logged();
    actor.value = { id: st.userId };
    expect((await get(s.id)).status).toBe(200);
    const res = await patch(s.id, { minutes: 45 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "Only the mentor who logged a session, or an admin, can edit it.",
    });
    expect((await stored(s.id)).minutes).toBe(60);
  });

  it("answers the mentor of a voided session in the action's words", async () => {
    const { m, s } = await logged();
    await prisma.session.update({ where: { id: s.id }, data: { status: "VOIDED" } });
    actor.value = { id: m.id };
    const res = await patch(s.id, { minutes: 45 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "You can only edit sessions you logged yourself, and not voided ones.",
    });
    expect((await stored(s.id)).minutes).toBe(60);
  });
});
