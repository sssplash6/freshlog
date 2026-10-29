import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, allocation, enroll, grant, mentor, pairing, program, session, student } from "@/test/db";

/** One student as the website's student page shows them, to an admin or to a mentor who reaches them. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/students/[id]/record/route");

const get = (id: string, query = "") => GET(new Request(`http://test${query}`), { params: Promise.resolve({ id }) });

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
  await prisma.studentProfile.update({ where: { id: aziz.id }, data: { telegramUsername: "aziz_t", folderUrl: "https://drive.test/aziz" } });
  await allocation({ studentId: aziz.id, programId: ga.id, mentorId: akmal.id, minutes: 240 });
  await allocation({ studentId: aziz.id, programId: masters.id, mentorId: akmal.id, minutes: 600 });
  await session({ studentId: aziz.id, programId: ga.id, mentorId: akmal.id, minutes: 60 });
  const nodira = await admin("Nodira Aliyeva");
  await grant({ userId: nodira.id, programId: ga.id });
  return { ga, masters, akmal, umid, aziz, nodira };
}

describe("GET /api/v1/students/:id/record", () => {
  it("gives a mentor who reaches them the whole record, every program's, with their contact and no controls or money", async () => {
    const { akmal, aziz, ga, masters } = await setUp();
    await prisma.program.update({ where: { id: ga.id }, data: { tracksPayment: true } });
    actor.value = { id: akmal.id };
    const body = await (await get(aziz.id, "?as=mentor")).json();
    expect(body.lens).toBe("mentor");
    expect(body.student).toMatchObject({ telegram: "aziz_t", folderUrl: "https://drive.test/aziz", email: expect.any(String) });
    // Registered is in the page's Details, which only staff read.
    expect(body.student.registered).toBeNull();
    expect(body.programs.map((p: { id: string }) => p.id).sort()).toEqual([ga.id, masters.id].sort());
    expect(body.hours).toMatchObject({ allotted: 840, completed: 60, remaining: 780 });
    expect(body.byProgram.map((line: { name: string; remaining: number }) => [line.name, line.remaining])).toEqual([
      ["Global Admissions", 180],
      ["Master's Program", 600],
    ]);
    expect(body.grants).toHaveLength(2);
    expect(body.grants.every((g: { amountPaid: unknown; can: Record<string, boolean> }) => g.amountPaid === null && !g.can.edit)).toBe(true);
    expect(body.history).toEqual([]);
    expect(body.paid).toBeNull();
    expect(body.can).toEqual({ approve: false, reject: false, allocate: false, reach: true, rename: true });
    // In the mentor's lens, the headline is their own time with them.
    expect(body.headline).toMatchObject({ figure: "13h remaining with you", danger: false });
    expect(body.log).toEqual({ can: true, reason: null, warns: false });
  });

  it("says why a session they log counts as extra, in the page's words", async () => {
    const { umid, aziz } = await setUp();
    actor.value = { id: umid.id };
    const body = await (await get(aziz.id, "?as=mentor")).json();
    expect(body.log).toEqual({
      can: true,
      reason: "You hold no time with them — a session you log here counts as extra time or an overdraw.",
      warns: false,
    });
    expect(body.headline).toBeNull();
  });

  it("says a pending student can't be logged for yet", async () => {
    const { akmal, aziz } = await setUp();
    await prisma.user.update({ where: { id: aziz.userId }, data: { status: "PENDING" } });
    actor.value = { id: akmal.id };
    expect((await (await get(aziz.id, "?as=mentor")).json()).log).toEqual({ can: false, reason: "This student is not approved yet.", warns: false });
  });

  it("a mentor who doesn't reach them, and a missing student, answer alike", async () => {
    const { aziz } = await setUp();
    actor.value = { id: (await mentor("Sardor Aliev")).id };
    const theirs = await get(aziz.id);
    const missing = await get("c-made-up");
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
  });

  it("gives an admin the student's whole balance in their programs, with the soonest use-by, and the paid total", async () => {
    const { nodira, aziz, ga } = await setUp();
    await prisma.program.update({ where: { id: ga.id }, data: { tracksPayment: true } });
    await prisma.hourAllocation.updateMany({ where: { studentId: aziz.id, programId: ga.id }, data: { amountPaid: 150 } });
    actor.value = { id: nodira.id };
    const body = await (await get(aziz.id)).json();
    expect(body.lens).toBe("staff");
    expect(body.headline).toMatchObject({ figure: "3h remaining", rest: expect.stringMatching(/^3h to use by /), danger: false });
    expect(body.paid).toBe(150);
    expect(body.byProgram).toEqual([]);
  });

  it("offers Allocate when a mentor works in any program the admin runs, not only the student's", async () => {
    const imkon = await program("Imkon");
    const ga = await program("Global Admissions");
    await pairing({ mentorId: (await mentor("Akmal Karimov")).id, programId: ga.id });
    const sitora = await student({ programId: imkon.id, name: "Sitora Nazarova" });
    const nodira = await admin("Nodira Aliyeva");
    await grant({ userId: nodira.id, programId: imkon.id });
    actor.value = { id: nodira.id };
    expect((await (await get(sitora.id)).json()).can.allocate).toBe(false);
    await grant({ userId: nodira.id, programId: ga.id });
    expect((await (await get(sitora.id)).json()).can.allocate).toBe(true);
  });
});
