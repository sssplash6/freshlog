import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { programToday } from "@/lib/when";
import { admin, DAY, grant, mentor, pairing, program, student } from "@/test/db";

/**
 * Setting a task. It runs `setStudentTask` itself, as the signed-in `actor`,
 * against the real database; `next/cache` is stood in for, and so is the mail
 * queue, which hands to `after()` and so cannot run outside a request.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
const outbox = vi.hoisted(() => ({ mails: [] as { to: string; subject: string }[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/email/send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/send")>()),
  queueEmails: (_tag: string, mails: { to: string; subject: string }[]) => {
    outbox.mails.push(...mails);
  },
}));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { POST } = await import("@/app/api/v1/tasks/route");

/** A JSON body, or a string sent as it is. */
const post = (body: unknown) =>
  POST(new Request("http://test", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

async function setUp(studentStatus?: string) {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id, status: studentStatus, name: "Aziz" });
  const m = await mentor("Akmal Karimov");
  await pairing({ mentorId: m.id, programId: p.id });
  const body = { studentProfileId: st.id, programId: p.id, title: "Rewrite the draft", due: "2099-11-03" };
  return { p, st, m, body };
}

beforeEach(() => {
  actor.value = null;
  outbox.mails.length = 0;
});

describe("POST /api/v1/tasks", () => {
  it("answers 401 with no user", async () => expect((await post({})).status).toBe(401));

  it("answers 403 inactive to an account that isn't active, and sets nothing", async () => {
    const { m, body } = await setUp();
    await prisma.user.update({ where: { id: m.id }, data: { status: "PENDING" } });
    actor.value = { id: m.id };
    const res = await post(body);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
    expect(await prisma.studentTask.count()).toBe(0);
  });

  it("answers a student who is not there like one the mentor may not set for: a 400 in freshform's words, and nothing set", async () => {
    const { m, body } = await setUp();
    actor.value = { id: m.id };
    const missing = await post({ ...body, studentProfileId: "c-made-up" });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ ok: false, error: "That student no longer exists." });

    const stranger = await mentor("Umid Rashidov");
    actor.value = { id: stranger.id };
    const theirs = await post(body);
    expect(theirs.status).toBe(400);
    expect(await theirs.json()).toMatchObject({ ok: false, error: "You don't work with that student in that program." });
    expect(await prisma.studentTask.count()).toBe(0);
  });

  it("setting a task notifies the student (TASK_SET) and answers ok with no id", async () => {
    const { st, m, body } = await setUp();
    actor.value = { id: m.id };

    const res = await post({ ...body, note: "Start with the intro." });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const answer = await res.json();
    expect(answer).toMatchObject({ ok: true });
    expect(answer.receipt).toBeUndefined();
    expect(answer.id).toBeUndefined();
    const tasks = await prisma.studentTask.findMany();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      studentId: st.id,
      mentorId: m.id,
      title: "Rewrite the draft",
      note: "Start with the intro.",
      percent: 0,
    });
    expect(tasks[0].dueOn.toISOString()).toBe("2099-11-03T00:00:00.000Z");
    const notices = await prisma.notification.findMany({ where: { type: "TASK_SET" } });
    expect(notices).toHaveLength(1);
    expect(notices[0].userId).toBe(st.userId);
    expect(outbox.mails.length).toBeGreaterThan(0);
  });

  it("lets an admin of the program set one, who then owns it", async () => {
    const { p, body } = await setUp();
    const a = await admin("Program Admin");
    await grant({ userId: a.id, programId: p.id });
    actor.value = { id: a.id };
    expect((await post(body)).status).toBe(200);
    expect((await prisma.studentTask.findFirstOrThrow()).mentorId).toBe(a.id);
  });

  it("refuses a day that does not exist on field \"due\", and sets nothing", async () => {
    const { m, body } = await setUp();
    actor.value = { id: m.id };
    const res = await post({ ...body, due: "2026-02-31" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, field: "due" });
    expect(await prisma.studentTask.count()).toBe(0);
  });

  it("refuses a day already past in Tashkent, and sets nothing; today is fine", async () => {
    const { m, body } = await setUp();
    actor.value = { id: m.id };
    const today = programToday();
    const yesterday = new Date(Date.parse(today) - DAY).toISOString().slice(0, 10);
    const res = await post({ ...body, due: yesterday });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "Pick today or a later day." });
    expect(await prisma.studentTask.count()).toBe(0);
    expect((await post({ ...body, due: today })).status).toBe(200);
  });

  it("refuses a body that is not an object, and a title over 100 characters", async () => {
    const { m, body } = await setUp();
    actor.value = { id: m.id };
    expect((await post("not json")).status).toBe(400);
    expect((await post([body])).status).toBe(400);
    const long = await post({ ...body, title: "x".repeat(101) });
    expect(long.status).toBe(400);
    expect((await long.json()).field).toBe("title");
    expect(await prisma.studentTask.count()).toBe(0);
  });
});
