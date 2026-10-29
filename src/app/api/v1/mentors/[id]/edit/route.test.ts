import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, grant, mentor, pairing, platformAdmin, program } from "@/test/db";

/** Editing a mentor, as the website's Edit fold on their page does, and their card for a colleague. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET: edit } = await import("@/app/api/v1/mentors/[id]/edit/route");
const { PATCH } = await import("@/app/api/v1/mentors/[id]/route");
const { GET: card } = await import("@/app/api/v1/mentors/[id]/card/route");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown) => PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify(body) }), ctx(id));

beforeEach(() => {
  actor.value = null;
});

async function setUp() {
  const ga = await program("Global Admissions");
  const imkon = await program("Imkon");
  const elsewhere = await program("Master's Program");
  const akmal = await mentor("Akmal Karimov");
  await pairing({ mentorId: akmal.id, programId: ga.id });
  await pairing({ mentorId: akmal.id, programId: elsewhere.id });
  const nodira = await admin("Nodira Aliyeva");
  await grant({ userId: nodira.id, programId: ga.id });
  await grant({ userId: nodira.id, programId: imkon.id });
  return { ga, imkon, elsewhere, akmal, nodira };
}

describe("GET /api/v1/mentors/:id/edit and PATCH /api/v1/mentors/:id", () => {
  it("offers an admin where the mentor works in their programs, and those programs; the name and email only a platform admin moves", async () => {
    const { ga, akmal, nodira } = await setUp();
    actor.value = { id: nodira.id };
    const body = await (await edit(new Request("http://test"), ctx(akmal.id))).json();
    expect(body).toMatchObject({ name: "Akmal Karimov", canEditDetails: false, targets: [{ program: ga.id }] });
    expect(body.programs.map((p: { name: string }) => p.name)).toEqual(["Global Admissions", "Imkon"]);
  });

  it("moves them to another of the admin's programs, keeping the pairing the admin doesn't run", async () => {
    const { imkon, elsewhere, akmal, nodira } = await setUp();
    actor.value = { id: nodira.id };
    expect((await patch(akmal.id, { targets: [{ program: imkon.id }] })).status).toBe(200);
    const pairs = await prisma.mentorAssignment.findMany({ where: { mentorId: akmal.id } });
    expect(pairs.map((a) => a.programId).sort()).toEqual([elsewhere.id, imkon.id].sort());
  });

  it("refuses a program admin a new name in the action's words, and lets a platform admin change it", async () => {
    const { akmal, nodira } = await setUp();
    actor.value = { id: nodira.id };
    const res = await patch(akmal.id, { name: "Akmal Karimov-Ali" });
    expect(res.status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: akmal.id } })).name).toBe("Akmal Karimov");
    actor.value = { id: (await platformAdmin()).id };
    expect((await patch(akmal.id, { name: "Akmal Karimov-Ali" })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: akmal.id } })).name).toBe("Akmal Karimov-Ali");
  });

  it("answers a mentor, and an admin of none of theirs, like no such mentor", async () => {
    const { akmal } = await setUp();
    actor.value = { id: akmal.id };
    expect((await edit(new Request("http://test"), ctx(akmal.id))).status).toBe(404);
    actor.value = { id: (await admin("Elsewhere Admin")).id };
    expect((await patch(akmal.id, { targets: [] })).status).toBe(404);
  });
});

describe("GET /api/v1/mentors/:id/card", () => {
  it("gives a colleague their pairings in the programs they share, with Book or the email, and nobody else anything", async () => {
    const { ga, akmal } = await setUp();
    await prisma.mentorAssignment.updateMany({ where: { mentorId: akmal.id, programId: ga.id }, data: { calendlyUrl: "https://cal.test/akmal" } });
    const umid = await mentor("Umid Rashidov");
    await pairing({ mentorId: umid.id, programId: ga.id });
    actor.value = { id: umid.id };
    const body = await (await card(new Request("http://test"), ctx(akmal.id))).json();
    expect(body).toMatchObject({ mentor: { id: akmal.id, name: "Akmal Karimov" }, pairings: [{ label: "Global Admissions", bookingUrl: "https://cal.test/akmal" }] });
    expect(body.pairings).toHaveLength(1);
    actor.value = { id: (await mentor("Stranger")).id };
    expect((await card(new Request("http://test"), ctx(akmal.id))).status).toBe(404);
  });
});
