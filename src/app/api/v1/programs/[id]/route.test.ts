import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, cohort, grant, level, mentor, pairing, platformAdmin, program, student } from "@/test/db";

/** A program, its settings, levels and cohorts: the website's actions, behind the admin's gate. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const one = await import("@/app/api/v1/programs/[id]/route");
const list = await import("@/app/api/v1/programs/route");
const options = await import("@/app/api/v1/programs/options/route");
const levels = await import("@/app/api/v1/programs/[id]/levels/route");
const cohorts = await import("@/app/api/v1/programs/[id]/cohorts/route");
const aLevel = await import("@/app/api/v1/levels/[id]/route");
const aCohort = await import("@/app/api/v1/cohorts/[id]/route");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request("http://test", { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const get = (id: string) => one.GET(req("GET"), ctx(id));
const patch = (id: string, body: unknown) => one.PATCH(req("PATCH", body), ctx(id));
const stored = (id: string) => prisma.program.findUniqueOrThrow({ where: { id } });

beforeEach(() => {
  actor.value = null;
});

async function setUp() {
  const p = await program("Global Admissions");
  const akmal = await mentor("Akmal Karimov");
  await pairing({ mentorId: akmal.id, programId: p.id });
  await student({ programId: p.id, name: "Aziz Tursunov" });
  const nodira = await admin("Nodira Aliyeva");
  await grant({ userId: nodira.id, programId: p.id });
  return { p, akmal, nodira };
}

describe("GET /api/v1/programs/:id", () => {
  it("answers 401, 403 inactive, and the same 404 for not yours and missing", async () => {
    expect((await get("x")).status).toBe(401);
    const { p } = await setUp();
    const pending = await student({ status: "PENDING" });
    actor.value = { id: pending.userId };
    expect((await (await get(p.id)).json()).code).toBe("inactive");
    const other = await admin("Elsewhere");
    await grant({ userId: other.id, programId: (await program("Other")).id });
    actor.value = { id: other.id };
    const theirs = await get(p.id);
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toEqual(await (await get("c-made-up")).json());
    actor.value = { id: (await platformAdmin("Head")).id };
    expect((await get("c-made-up")).status).toBe(404);
  });

  it("answers the program, its figures, mentors, admins and who else could be assigned", async () => {
    const { p, akmal, nodira } = await setUp();
    const umid = await mentor("Umid Rashidov");
    const lvl = await level({ programId: p.id, name: "Emerging", standardMinutes: 600, standardDays: 90 });
    await cohort({ programId: p.id, levelId: lvl.id, name: "Autumn" });
    actor.value = { id: nodira.id };
    const body = await (await get(p.id)).json();
    expect(body.program).toMatchObject({ id: p.id, name: "Global Admissions", archived: false, hourBank: false, standard: null });
    expect(body.totals.students).toBe(1);
    expect(body.levels).toEqual([
      expect.objectContaining({ name: "Emerging", standard: { minutes: 600, days: 90 }, cohorts: [expect.objectContaining({ name: "Autumn", inUse: false })], canDelete: false }),
    ]);
    expect(body.mentors).toEqual([expect.objectContaining({ mentor: { id: akmal.id, name: "Akmal Karimov" }, scope: "Global Admissions" })]);
    expect(body.admins).toEqual([{ person: { id: nodira.id, name: "Nodira Aliyeva" }, level: "admin" }]);
    expect(body.eligibleMentors).toEqual([expect.objectContaining({ id: umid.id, name: "Umid Rashidov" })]);
    expect(body.can).toEqual({
      write: true,
      platform: false,
      delete: false,
      deleteBlocked: "Global Admissions still has 1 student. Archive it instead, or move them first.",
    });
  });
});

describe("PATCH /api/v1/programs/:id", () => {
  it("changes one setting a request, each toggle on and off", async () => {
    const { p, nodira } = await setUp();
    actor.value = { id: nodira.id };
    for (const field of ["tracksPayment", "hourBank", "classHours"] as const) {
      expect((await patch(p.id, { [field]: true })).status).toBe(200);
      expect((await stored(p.id))[field]).toBe(true);
      expect((await patch(p.id, { [field]: false })).status).toBe(200);
      expect((await stored(p.id))[field]).toBe(false);
    }
    expect((await patch(p.id, { name: "Global Admissions 2027" })).status).toBe(200);
    expect((await stored(p.id)).name).toBe("Global Admissions 2027");
    expect((await patch(p.id, { standard: { minutes: 600, days: 90 } })).status).toBe(200);
    expect(await stored(p.id)).toMatchObject({ standardMinutes: 600, standardDays: 90 });
    expect((await patch(p.id, { standard: null })).status).toBe(200);
    expect(await stored(p.id)).toMatchObject({ standardMinutes: null, standardDays: null });
    expect((await patch(p.id, { archived: true })).status).toBe(200);
    expect((await stored(p.id)).status).toBe("ARCHIVED");
    expect((await patch(p.id, { archived: false })).status).toBe(200);
    expect((await stored(p.id)).status).toBe("ACTIVE");
  });

  it("refuses two settings at once, none, and a bad value on its field", async () => {
    const { p, nodira } = await setUp();
    actor.value = { id: nodira.id };
    expect((await (await patch(p.id, { hourBank: true, classHours: true })).json()).error).toBe("Change one setting at a time.");
    expect((await patch(p.id, {})).status).toBe(400);
    expect((await (await patch(p.id, { hourBank: "yes" })).json()).field).toBe("hourBank");
    expect((await (await patch(p.id, { standard: { minutes: 600 } })).json()).field).toBe("standard");
    expect((await stored(p.id)).hourBank).toBe(false);
  });

  it("lets only a platform admin turn admissions on, and the program turn it off", async () => {
    const { p, nodira } = await setUp();
    actor.value = { id: nodira.id };
    expect((await patch(p.id, { tracksAdmissions: true })).status).toBe(403);
    expect((await stored(p.id)).tracksAdmissions).toBe(false);
    actor.value = { id: (await platformAdmin("Head")).id };
    expect((await patch(p.id, { schedulesClasses: true })).status).toBe(200);
    actor.value = { id: nodira.id };
    expect((await patch(p.id, { schedulesClasses: false })).status).toBe(200);
    expect((await stored(p.id)).schedulesClasses).toBe(false);
  });

  it("gives a Leader a 403 and reads them can.write false", async () => {
    const { p } = await setUp();
    const leader = await admin("Lola Leader");
    await grant({ userId: leader.id, programId: p.id, role: "LEADER" });
    actor.value = { id: leader.id };
    expect((await (await get(p.id)).json()).can.write).toBe(false);
    expect((await patch(p.id, { hourBank: true })).status).toBe(403);
  });
});

describe("DELETE /api/v1/programs/:id", () => {
  it("is a platform admin's, refused while students stand, and done through the redirect", async () => {
    const { p, nodira } = await setUp();
    actor.value = { id: nodira.id };
    expect((await one.DELETE(req("DELETE"), ctx(p.id))).status).toBe(403);
    const boss = await platformAdmin("Head");
    actor.value = { id: boss.id };
    expect((await one.DELETE(req("DELETE"), ctx(p.id))).status).toBe(400);
    const empty = await program("Empty Program");
    expect((await (await get(empty.id)).json()).can).toMatchObject({ delete: true, deleteBlocked: null });
    const res = await one.DELETE(req("DELETE"), ctx(empty.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await prisma.program.findUnique({ where: { id: empty.id } })).toBeNull();
  });
});

describe("GET and POST /api/v1/programs, GET programs/options", () => {
  it("lists the reader's programs, and is a 404 to a reader with none", async () => {
    const { p, nodira } = await setUp();
    actor.value = { id: nodira.id };
    expect((await (await list.GET()).json()).map((row: { program: { id: string } }) => row.program.id)).toEqual([p.id]);
    actor.value = { id: (await mentor("Just A Mentor")).id };
    expect((await list.GET()).status).toBe(404);
  });

  it("makes a program for a platform admin, and is a 404 to anyone else", async () => {
    const { nodira } = await setUp();
    actor.value = { id: nodira.id };
    expect((await list.POST(req("POST", { name: "New Program" }))).status).toBe(404);
    actor.value = { id: (await platformAdmin("Head")).id };
    const res = await list.POST(req("POST", { name: "New Program" }));
    expect(res.status).toBe(200);
    expect(await prisma.program.count({ where: { name: "New Program" } })).toBe(1);
  });

  it("offers running programs the reader may change, with levels and cohorts", async () => {
    const { p, nodira } = await setUp();
    await prisma.program.update({ where: { id: p.id }, data: { classHours: true } });
    const archived = await program("Old Program");
    await prisma.program.update({ where: { id: archived.id }, data: { status: "ARCHIVED" } });
    await grant({ userId: nodira.id, programId: archived.id });
    const lvl = await level({ programId: p.id, name: "Emerging" });
    await cohort({ programId: p.id, levelId: lvl.id, name: "Autumn" });
    actor.value = { id: nodira.id };
    expect(await (await options.GET()).json()).toEqual([
      { id: p.id, name: "Global Admissions", colorIndex: 0, classHours: true, levels: [{ id: lvl.id, name: "Emerging", cohorts: [expect.objectContaining({ name: "Autumn" })] }], cohorts: [] },
    ]);
  });
});

describe("levels and cohorts", () => {
  it("makes and deletes a level and a cohort, refusing one in use", async () => {
    const { p, nodira } = await setUp();
    actor.value = { id: nodira.id };
    expect((await levels.POST(req("POST", { name: "Emerging" }), ctx(p.id))).status).toBe(200);
    const lvl = await prisma.programLevel.findFirstOrThrow({ where: { programId: p.id } });
    expect((await aLevel.PATCH(req("PATCH", { standard: { minutes: 300, days: 60 } }), ctx(lvl.id))).status).toBe(200);
    expect(await prisma.programLevel.findUniqueOrThrow({ where: { id: lvl.id } })).toMatchObject({ standardMinutes: 300, standardDays: 60 });
    expect((await cohorts.POST(req("POST", { name: "Autumn", level: lvl.id }), ctx(p.id))).status).toBe(200);
    const c = await prisma.cohort.findFirstOrThrow({ where: { programId: p.id } });
    await student({ programId: p.id, levelId: lvl.id, cohortId: c.id });
    expect((await aCohort.DELETE(req("DELETE"), ctx(c.id))).status).toBe(400);
    expect((await aLevel.DELETE(req("DELETE"), ctx(lvl.id))).status).toBe(400);
    await prisma.studentEnrollment.deleteMany({ where: { cohortId: c.id } });
    expect((await aCohort.DELETE(req("DELETE"), ctx(c.id))).status).toBe(200);
    expect((await aLevel.DELETE(req("DELETE"), ctx(lvl.id))).status).toBe(200);
    expect(await prisma.programLevel.count({ where: { programId: p.id } })).toBe(0);
  });

  it("a level or cohort in a program the reader does not read is a 404, like a missing one", async () => {
    const { nodira } = await setUp();
    const other = await program("Other");
    const lvl = await level({ programId: other.id });
    const c = await cohort({ programId: other.id });
    actor.value = { id: nodira.id };
    expect(await (await aLevel.DELETE(req("DELETE"), ctx(lvl.id))).json()).toEqual({ ok: false, error: "Not found." });
    expect((await aLevel.DELETE(req("DELETE"), ctx("c-made-up"))).status).toBe(404);
    expect((await aCohort.DELETE(req("DELETE"), ctx(c.id))).status).toBe(404);
    expect((await levels.POST(req("POST", { name: "Sneaky" }), ctx(other.id))).status).toBe(404);
  });
});
