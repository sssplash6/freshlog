import { beforeEach, describe, expect, it, vi } from "vitest";

import { toDateInputValue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { programToday } from "@/lib/when";
import { allocation, assignment, DAY, enroll, mentor, pairing, platformAdmin, program, student } from "@/test/db";

/**
 * Logging a session: `POST /api/v1/sessions` is the website's own `logSession`,
 * called as the signed-in mentor. So its refusals are the website's words, and
 * these tests read what it logged back through the same `sessionFor` the app
 * reads with.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { POST } = await import("@/app/api/v1/sessions/route");
const { readerFor, sessionFor } = await import("@/lib/api/v1/sessions");

beforeEach(() => {
  actor.value = null;
});

/** A request to log, from a body that is JSON, or from `raw` text. */
const post = (body: unknown) =>
  POST(
    new Request("http://test/api/v1/sessions", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

/** A mentor, signed in, paired with a program that has a student in it holding 600 minutes with them. */
async function world() {
  const p = await program("Global Admissions");
  const m = await mentor("Akmal Karimov");
  await pairing({ mentorId: m.id, programId: p.id });
  const st = await student({ programId: p.id, name: "Aziz Tursunov" });
  await allocation({ studentId: st.id, mentorId: m.id, minutes: 600 });
  actor.value = { id: m.id };
  return { p, m, st, body: { studentProfileId: st.id, day: "2026-10-22", minutes: 60 } };
}

/** The session as the mentor reads it back. */
const readBack = async (m: Parameters<typeof readerFor>[0], id: string) => sessionFor(await readerFor(m), id);

describe("POST /api/v1/sessions", () => {
  it("answers 401 with no user", async () => {
    const res = await post({});
    expect(res.status).toBe(401);
  });

  it("answers 403 inactive to an account that isn't active, and logs nothing", async () => {
    const { m, body } = await world();
    await prisma.user.update({ where: { id: m.id }, data: { status: "UNASSIGNED" } });
    const res = await post(body);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
    expect(await prisma.session.count()).toBe(0);
  });

  it("logs as the signed-in mentor and answers the new session's id", async () => {
    const { m, body } = await world();
    const res = await post(body);
    expect(res.status).toBe(200);
    const sent = await res.json();
    // The contract's receipt, key for key: not the `subject` logSession adds for the website's.
    expect(sent).toEqual({
      ok: true,
      message: expect.stringMatching(/^Logged 1h with Aziz Tursunov\. /),
      receipt: { id: expect.any(String), headline: "Logged 1h with Aziz Tursunov.", notes: [expect.any(String)] },
    });
    expect(await readBack(m, sent.receipt.id)).toMatchObject({
      day: "2026-10-22",
      minutes: 60,
      attendance: "ATTENDED",
      kind: "PLAN",
      mentor: { id: m.id },
    });
  });

  it("logs a session for today in Tashkent, the latest day it allows", async () => {
    const { m, body } = await world();
    const res = await post({ ...body, day: programToday() });
    expect(res.status).toBe(200);
    expect((await readBack(m, (await res.json()).receipt.id))?.day).toBe(programToday());
  });

  it("a day in the future is refused in the action's words, on date, with nothing echoed", async () => {
    const { body } = await world();
    const tomorrow = toDateInputValue(new Date(Date.parse(`${programToday()}T00:00:00.000Z`) + DAY));
    const res = await post({ ...body, day: tomorrow, note: "Went through the essay." });
    expect(res.status).toBe(400);
    // `logSession` echoes everything typed for a web form to refill itself from, the note included.
    expect(await res.json()).toEqual({
      ok: false,
      error: "A session can't be dated in the future. Pick today or an earlier day.",
      field: "date",
    });
    expect(await prisma.session.count()).toBe(0);
  });

  it("the same log twice within a minute is refused", async () => {
    const { body } = await world();
    expect((await post(body)).status).toBe(200);
    const second = await post(body);
    expect(second.status).toBe(400);
    expect((await second.json()).error).toMatch(/^That session is already logged/);
    expect(await prisma.session.count()).toBe(1);
  });

  it("carries the program, attendance, kind, note and plan item to the log", async () => {
    const { p, m, st, body } = await world();
    const essay = await assignment({ studentId: st.id, mentorId: m.id, purpose: "Main essay" });
    const res = await post({
      ...body,
      programId: p.id,
      attendance: "LATE",
      kind: "EXTRA",
      note: "Went through the essay.",
      assignmentId: essay.id,
    });
    expect(res.status).toBe(200);
    expect(await readBack(m, (await res.json()).receipt.id)).toMatchObject({
      program: { id: p.id },
      attendance: "LATE",
      kind: "EXTRA",
      charged: false,
      note: "Went through the essay.",
      task: { id: essay.id },
    });
  });

  it("asks which program when the student is in two of the mentor's, and logs in the one it is told", async () => {
    const { m, st, body } = await world();
    const masters = await program("Master's Program");
    await pairing({ mentorId: m.id, programId: masters.id });
    await enroll({ studentId: st.id, programId: masters.id });

    const unsaid = await post(body);
    expect(unsaid.status).toBe(400);
    expect(await unsaid.json()).toMatchObject({ field: "programId" });

    const said = await post({ ...body, programId: masters.id });
    expect(said.status).toBe(200);
    expect((await readBack(m, (await said.json()).receipt.id))?.program.id).toBe(masters.id);
  });

  it("tells a student who doesn't exist from one who isn't the mentor's, in the website's words", async () => {
    const { body } = await world();
    const elsewhere = await student({ programId: (await program("Master's Program")).id, name: "Malika Rahimova" });

    const unknown = await post({ ...body, studentProfileId: "c-made-up" });
    const notTheirs = await post({ ...body, studentProfileId: elsewhere.id });

    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ ok: false, error: "Student not found.", field: "studentProfileId" });
    expect(notTheirs.status).toBe(400);
    expect(await notTheirs.json()).toEqual({
      ok: false,
      error: "You aren't assigned to that student's program, so you can't log hours for them.",
      field: "studentProfileId",
    });
  });

  it("logs past the hours and past the use-by, and only says so", async () => {
    const { m, st, p, body } = await world();
    // 700 minutes against a grant of 600.
    const over = await post({ ...body, minutes: 700 });
    expect(over.status).toBe(200);
    expect((await over.json()).message).toMatch(/overdrawn/);

    const lapsed = await student({ programId: p.id, name: "Bobur Qodirov" });
    await allocation({ studentId: lapsed.id, mentorId: m.id, minutes: 600, deadlineInDays: -30 });
    const past = await post({ ...body, studentProfileId: lapsed.id });
    expect(past.status).toBe(200);
    expect((await past.json()).message).toMatch(/past the deadline/);

    expect(await prisma.session.count({ where: { studentId: { in: [st.id, lapsed.id] } } })).toBe(2);
  });

  it("never logs in somebody else's name, whatever the body says", async () => {
    // Left to the action, an admin who runs the program could name the mentor and log for them
    // (Phase 4). The app's log carries no `mentorId`, so it is an admin without a mentor's role.
    const { m, body } = await world();
    actor.value = { id: (await platformAdmin("Nodira Aliyeva")).id };
    const res = await post({ ...body, mentorId: m.id });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Only assigned mentors can log sessions.");
    expect(await prisma.session.count()).toBe(0);
  });

  it("refuses a field of the wrong type, naming it, and logs nothing", async () => {
    const { body } = await world();
    const res = await post({ ...body, minutes: "60" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "That isn't a valid value.", field: "minutes" });
    expect(await prisma.session.count()).toBe(0);
  });

  it.each([
    ["text that isn't JSON", "minutes=60"],
    ["an array", "[1]"],
    ["null", "null"],
    ["nothing", ""],
  ])("refuses %s", async (_, raw) => {
    await world();
    const res = await post(raw);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Send the session as JSON." });
    expect(await prisma.session.count()).toBe(0);
  });
});
