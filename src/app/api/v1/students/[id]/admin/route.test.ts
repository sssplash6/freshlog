import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, allocation, assignment, enroll, grant, mentor, pairing, program, session, student } from "@/test/db";

/** One student as an admin of one of their programs reads them. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/students/[id]/admin/route");

const get = (id: string) => GET(new Request("http://test"), { params: Promise.resolve({ id }) });

beforeEach(() => {
  actor.value = null;
});

async function setUp() {
  const ga = await program("Global Admissions");
  const masters = await program("Master's Program");
  const akmal = await mentor("Akmal Karimov");
  const umid = await mentor("Umid Rashidov");
  await pairing({ mentorId: akmal.id, programId: ga.id });
  await pairing({ mentorId: umid.id, programId: ga.id });
  const aziz = await student({ programId: ga.id, name: "Aziz Tursunov" });
  await enroll({ studentId: aziz.id, programId: masters.id });
  await allocation({ studentId: aziz.id, programId: ga.id, mentorId: akmal.id, minutes: 240 });
  await allocation({ studentId: aziz.id, programId: masters.id, mentorId: akmal.id, minutes: 600 });
  await session({ studentId: aziz.id, programId: ga.id, mentorId: akmal.id, minutes: 60 });
  const nodira = await admin("Nodira Aliyeva");
  await grant({ userId: nodira.id, programId: ga.id });
  return { ga, masters, akmal, umid, aziz, nodira };
}

describe("GET /api/v1/students/:id/admin", () => {
  it("answers 401 with no user", async () => expect((await get("x")).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    const s = await student({ status: "PENDING" });
    actor.value = { id: s.userId };
    expect((await (await get(s.id)).json()).code).toBe("inactive");
  });

  it("a student outside the reader's programs answers like a missing one", async () => {
    const { nodira } = await setUp();
    const elsewhere = await student({ name: "Sitora Nazarova" });
    actor.value = { id: nodira.id };
    const theirs = await get(elsewhere.id);
    const missing = await get("c-made-up");
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
  });

  it("reads only the reader's program of a two-program student", async () => {
    const { nodira, aziz, akmal, ga } = await setUp();
    actor.value = { id: nodira.id };
    const res = await get(aziz.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.programs).toEqual([{ id: ga.id, name: "Global Admissions", colorIndex: 0, level: null, cohort: null, visit: false }]);
    expect(body.hours).toMatchObject({ allotted: 240, completed: 60, remaining: 180 });
    expect(body.grants).toEqual([
      expect.objectContaining({
        mentor: { id: akmal.id, name: "Akmal Karimov" },
        bank: false,
        allocated: 240,
        assigned: 240,
        remaining: 180,
        amountPaid: null,
        can: { edit: true, transfer: true, remove: true },
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain("Master");
    expect(body.can).toEqual({ approve: false, reject: false, allocate: true, reach: false });
    expect(body.student).toMatchObject({ name: "Aziz Tursunov", telegram: null, folderUrl: null });
  });

  it("Assigned is the open plan's budget where it comes to more, and planned work with no grant is a row", async () => {
    const { nodira, aziz, akmal, umid, ga } = await setUp();
    await assignment({ studentId: aziz.id, programId: ga.id, mentorId: akmal.id, minuteLimit: 300 });
    const done = await assignment({ studentId: aziz.id, programId: ga.id, mentorId: akmal.id, minuteLimit: 600 });
    await prisma.assignment.update({ where: { id: done.id }, data: { progress: "DONE" } });
    await assignment({ studentId: aziz.id, programId: ga.id, mentorId: umid.id, minuteLimit: 120 });
    actor.value = { id: nodira.id };
    const body = await (await get(aziz.id)).json();
    const akmalRow = body.grants.find((g: { mentor: { id: string } }) => g.mentor.id === akmal.id);
    const umidRow = body.grants.find((g: { mentor: { id: string } }) => g.mentor.id === umid.id);
    expect(akmalRow).toMatchObject({ allocated: 240, assigned: 300 });
    expect(umidRow).toMatchObject({ allocated: 0, assigned: 120, deadline: null, can: { edit: false, transfer: false, remove: false } });
  });

  it("gives a Leader the page and no controls", async () => {
    const { aziz, ga } = await setUp();
    await prisma.user.update({ where: { id: aziz.userId }, data: { status: "PENDING" } });
    const leader = await admin("Lola Leader");
    await grant({ userId: leader.id, programId: ga.id, role: "LEADER" });
    actor.value = { id: leader.id };
    const body = await (await get(aziz.id)).json();
    expect(body.approved).toBe(false);
    expect(body.can).toEqual({ approve: false, reject: false, allocate: false, reach: false });
    expect(body.grants.every((g: { can: Record<string, boolean> }) => !g.can.edit && !g.can.transfer && !g.can.remove)).toBe(true);
  });

  it("a pending student can be approved or rejected by an admin", async () => {
    const { nodira, aziz } = await setUp();
    await prisma.user.update({ where: { id: aziz.userId }, data: { status: "PENDING" } });
    actor.value = { id: nodira.id };
    const body = await (await get(aziz.id)).json();
    expect(body.can).toMatchObject({ approve: true, reject: true });
  });

  it("lists the changes to their time, newest first, in the reader's programs", async () => {
    const { nodira, aziz, akmal, ga, masters } = await setUp();
    await prisma.hourAllotmentChange.create({ data: { studentId: aziz.id, programId: ga.id, mentorId: akmal.id, changedById: nodira.id, oldMinutes: 120, newMinutes: 240 } });
    await prisma.hourAllotmentChange.create({ data: { studentId: aziz.id, programId: masters.id, mentorId: akmal.id, changedById: nodira.id, oldMinutes: 0, newMinutes: 600 } });
    actor.value = { id: nodira.id };
    const body = await (await get(aziz.id)).json();
    expect(body.history).toEqual([
      expect.objectContaining({ from: 120, to: 240, bank: false, mentor: { id: akmal.id, name: "Akmal Karimov" }, by: { id: nodira.id, name: "Nodira Aliyeva" } }),
    ]);
  });

  it("says what was paid only where the program bills per student", async () => {
    const { nodira, aziz, ga } = await setUp();
    await prisma.program.update({ where: { id: ga.id }, data: { tracksPayment: true } });
    await prisma.hourAllocation.updateMany({ where: { studentId: aziz.id, programId: ga.id }, data: { amountPaid: 150 } });
    actor.value = { id: nodira.id };
    const body = await (await get(aziz.id)).json();
    expect(body.grants[0].amountPaid).toBe(150);
  });
});
