import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, allocation, grant, mentor, pairing, program, session, student } from "@/test/db";

/**
 * A student's Details, enrolments, deleting a student or a session, and a task
 * for a whole program: each the website's own action, which decides who may.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// A program task emails each student after the answer; nothing is sent from a test.
vi.mock("@/lib/email/send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/send")>()),
  queueEmails: () => {},
}));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const details = await import("@/app/api/v1/students/[id]/route");
const enrol = await import("@/app/api/v1/students/[id]/enrollments/route");
const enrolment = await import("@/app/api/v1/enrollments/[id]/route");
const sessions = await import("@/app/api/v1/sessions/[id]/route");
const tasks = await import("@/app/api/v1/programs/[id]/tasks/route");
const adminRead = await import("@/app/api/v1/students/[id]/admin/route");

const json = (method: string, body?: unknown) =>
  new Request("http://test", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function world() {
  const ga = await program("Global Admissions");
  const ms = await program("Master's");
  const nodira = await admin("Nodira Aliyeva");
  await grant({ userId: nodira.id, programId: ga.id });
  await grant({ userId: nodira.id, programId: ms.id });
  const aziz = await student({ programId: ga.id, name: "Aziz Tursunov" });
  return { ga, ms, nodira, aziz };
}

beforeEach(() => {
  actor.value = null;
});

describe("a student's Details", () => {
  it("changes one detail a request through its own action, and refuses a reader the action refuses", async () => {
    const { nodira, aziz } = await world();
    actor.value = { id: nodira.id };
    expect(await (await details.PATCH(json("PATCH", { name: "Aziz T. Tursunov" }), ctx(aziz.id))).json()).toMatchObject({ ok: true });
    expect(await (await details.PATCH(json("PATCH", { telegram: "aziz_t" }), ctx(aziz.id))).json()).toMatchObject({ ok: true });
    expect(await (await details.PATCH(json("PATCH", { folder: "https://drive.test/aziz" }), ctx(aziz.id))).json()).toMatchObject({ ok: true });
    const saved = await prisma.studentProfile.findUniqueOrThrow({ where: { id: aziz.id }, include: { user: true } });
    expect([saved.user.name, saved.telegramUsername, saved.folderUrl]).toEqual(["Aziz T. Tursunov", "aziz_t", "https://drive.test/aziz"]);
    expect((await (await details.PATCH(json("PATCH", { name: "A", email: "b@test.invalid" }), ctx(aziz.id))).json()).error).toBe("Change one detail at a time.");
    expect((await (await details.PATCH(json("PATCH", { email: 3 }), ctx(aziz.id))).json()).field).toBe("email");
    // A mentor with no reach is refused by the action, and nothing changes.
    actor.value = { id: (await mentor("Stranger")).id };
    expect(await (await details.PATCH(json("PATCH", { telegram: "nope" }), ctx(aziz.id))).json()).toMatchObject({ ok: false });
    expect((await prisma.studentProfile.findUniqueOrThrow({ where: { id: aziz.id } })).telegramUsername).toBe("aziz_t");
  });

  it("gives a writer what the Details change, and a mentor who reaches them only the name", async () => {
    const { ga, ms, nodira, aziz } = await world();
    actor.value = { id: nodira.id };
    const read = await (await adminRead.GET(new Request("http://test"), ctx(aziz.id))).json();
    expect(read.can.rename).toBe(true);
    expect(read.manage.enrollments).toMatchObject([{ program: { id: ga.id }, label: "Global Admissions" }]);
    expect(read.manage.choices.map((c: { id: string }) => c.id).sort()).toEqual([ga.id, ms.id].sort());
    expect(read.manage.hasSessions).toBe(false);
  });
});

describe("enrolments", () => {
  it("adds a program, moves one, and takes them off one, as the page's Programs does", async () => {
    const { ga, ms, nodira, aziz } = await world();
    actor.value = { id: nodira.id };
    expect(await (await enrol.POST(json("POST", { program: ms.id }), ctx(aziz.id))).json()).toMatchObject({ ok: true });
    const rows = await prisma.studentEnrollment.findMany({ where: { studentId: aziz.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.programId).sort()).toEqual([ga.id, ms.id].sort());
    const third = await program("Bridge");
    await grant({ userId: nodira.id, programId: third.id });
    const inMs = rows.find((r) => r.programId === ms.id)!;
    expect(await (await enrolment.PATCH(json("PATCH", { program: third.id }), ctx(inMs.id))).json()).toMatchObject({ ok: true });
    expect((await prisma.studentEnrollment.findUniqueOrThrow({ where: { id: inMs.id } })).programId).toBe(third.id);
    expect(await (await enrolment.DELETE(json("DELETE"), ctx(inMs.id))).json()).toMatchObject({ ok: true });
    expect(await prisma.studentEnrollment.count({ where: { studentId: aziz.id } })).toBe(1);
    expect((await (await enrolment.PATCH(json("PATCH", { program: 7 }), ctx(inMs.id))).json()).field).toBe("program");
  });
});

describe("enrolments, to a reader who can't open the student's page", () => {
  it("answers adding, moving and taking off like a student that doesn't exist, as the website offers them only on that page", async () => {
    const { ga, aziz } = await world();
    const other = await program("Elsewhere");
    const stranger = await admin("Somebody Else");
    await grant({ userId: stranger.id, programId: other.id });
    actor.value = { id: stranger.id };
    // An admin of another program can't pull a student they can't see into it, and so on to their email.
    expect((await enrol.POST(json("POST", { program: other.id }), ctx(aziz.id))).status).toBe(404);
    const row = await prisma.studentEnrollment.findFirstOrThrow({ where: { studentId: aziz.id } });
    expect((await enrolment.PATCH(json("PATCH", { program: other.id }), ctx(row.id))).status).toBe(404);
    expect((await enrolment.DELETE(json("DELETE"), ctx(row.id))).status).toBe(404);
    expect((await prisma.studentEnrollment.findUniqueOrThrow({ where: { id: row.id } })).programId).toBe(ga.id);
  });
});

describe("deleting", () => {
  it("deletes a student added by mistake, and refuses once a session counts", async () => {
    const { ga, nodira, aziz } = await world();
    actor.value = { id: nodira.id };
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: ga.id });
    const malika = await student({ programId: ga.id, name: "Malika Rahimova" });
    await allocation({ studentId: malika.id, mentorId: m.id, minutes: 120 });
    await session({ studentId: malika.id, mentorId: m.id, minutes: 60 });
    expect(await (await details.DELETE(json("DELETE"), ctx(malika.id))).json()).toMatchObject({ ok: false });
    expect(await (await details.DELETE(json("DELETE"), ctx(aziz.id))).json()).toEqual({ ok: true });
    expect(await prisma.studentProfile.findUnique({ where: { id: aziz.id } })).toBeNull();
  });

  it("deletes a session for an admin of its program only, in one answer for missing and not theirs", async () => {
    const { ga, nodira } = await world();
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: ga.id });
    const malika = await student({ programId: ga.id, name: "Malika Rahimova" });
    await allocation({ studentId: malika.id, mentorId: m.id, minutes: 120 });
    const s = await session({ studentId: malika.id, mentorId: m.id, minutes: 60 });
    actor.value = { id: m.id };
    expect((await (await sessions.DELETE(json("DELETE"), ctx(s.id))).json()).error).toMatch(/Only admins can delete a session/);
    actor.value = { id: nodira.id };
    expect(await (await sessions.DELETE(json("DELETE"), ctx("nope"))).json()).toMatchObject({ ok: false, error: "That session is gone, or isn't in a program you administer." });
    expect(await (await sessions.DELETE(json("DELETE"), ctx(s.id))).json()).toMatchObject({ ok: true });
    expect(await prisma.session.count({ where: { id: s.id } })).toBe(0);
  });
});

describe("a task for the whole program", () => {
  it("sets one task for every student in it, judging the body first", async () => {
    const { ga, nodira, aziz } = await world();
    const malika = await student({ programId: ga.id, name: "Malika Rahimova" });
    actor.value = { id: nodira.id };
    expect((await (await tasks.POST(json("POST", { title: "Essay draft", due: "2026-13-40" }), ctx(ga.id))).json()).field).toBe("due");
    expect(await (await tasks.POST(json("POST", { title: "Essay draft", due: "2099-11-20" }), ctx(ga.id))).json()).toMatchObject({ ok: true });
    expect((await prisma.studentTask.findMany({ where: { title: "Essay draft" } })).map((t) => t.studentId).sort()).toEqual([aziz.id, malika.id].sort());
    actor.value = { id: (await mentor("Stranger")).id };
    expect(await (await tasks.POST(json("POST", { title: "Nope", due: "2099-11-20" }), ctx(ga.id))).json()).toMatchObject({ ok: false });
  });
});
