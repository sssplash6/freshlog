import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionsPage } from "@/lib/api/v1/types";
import { prisma } from "@/lib/prisma";
import { admin, assignment, grant, mentor, pairing, program, session, student } from "@/test/db";

/** `as=admin`: every session in the programs the reader reads, and the mentors they may log for. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/sessions/route");
const logMentors = (await import("@/app/api/v1/log-mentors/route")).GET;

const get = (query = "") => GET(new Request(`http://test/api/v1/sessions${query}`));
const names = async (query: string) =>
  ((await (await get(query)).json()) as SessionsPage).items.map((s) => `${s.student.name}/${s.mentor.name}`);

beforeEach(() => {
  actor.value = null;
});

async function school() {
  const ga = await program("Global Admissions");
  const masters = await program("Master's Program");
  const akmal = await mentor("Akmal Karimov");
  const umid = await mentor("Umid Rashidov");
  await pairing({ mentorId: akmal.id, programId: ga.id });
  await pairing({ mentorId: umid.id, programId: masters.id });
  const aziz = await student({ programId: ga.id, name: "Aziz Tursunov" });
  const malika = await student({ programId: ga.id, name: "Malika Saidova" });
  const sitora = await student({ programId: masters.id, name: "Sitora Nazarova" });
  const essay = await assignment({ studentId: aziz.id, mentorId: akmal.id, purpose: "Main essay" });
  await session({ studentId: aziz.id, mentorId: akmal.id, minutes: 60, assignmentId: essay.id });
  await session({ studentId: malika.id, mentorId: akmal.id, minutes: 30 });
  await session({ studentId: sitora.id, mentorId: umid.id, minutes: 45 });
  const nodira = await admin("Nodira Aliyeva");
  await grant({ userId: nodira.id, programId: ga.id });
  return { ga, masters, akmal, umid, aziz, malika, essay, nodira };
}

describe("GET /api/v1/sessions?as=admin", () => {
  it("lists every session in the reader's programs, and none elsewhere", async () => {
    const { nodira } = await school();
    actor.value = { id: nodira.id };
    const res = await get("?as=admin");
    expect(res.status).toBe(200);
    expect((await names("?as=admin")).sort()).toEqual(["Aziz Tursunov/Akmal Karimov", "Malika Saidova/Akmal Karimov"]);
  });

  it("narrows to one student, a search, and one plan item", async () => {
    const { nodira, aziz, essay } = await school();
    actor.value = { id: nodira.id };
    expect(await names(`?as=admin&student=${aziz.id}`)).toEqual(["Aziz Tursunov/Akmal Karimov"]);
    expect(await names("?as=admin&q=Malika")).toEqual(["Malika Saidova/Akmal Karimov"]);
    expect(await names(`?as=admin&assignment=${essay.id}`)).toEqual(["Aziz Tursunov/Akmal Karimov"]);
    expect((await names("?as=admin&assignment=%20")).length).toBe(2);
  });

  it("gives a Leader the list with nothing to change", async () => {
    const { ga } = await school();
    const leader = await admin("Lola Leader");
    await grant({ userId: leader.id, programId: ga.id, role: "LEADER" });
    actor.value = { id: leader.id };
    const page = (await (await get("?as=admin")).json()) as SessionsPage;
    expect(page.items).toHaveLength(2);
    expect(page.items.every((s) => !s.can.edit && !s.can.void)).toBe(true);
  });

  it("answers 404 to a reader with no program to read, and leaves a mentor's own list as it was", async () => {
    const { akmal } = await school();
    actor.value = { id: (await admin("No Grants")).id };
    expect((await get("?as=admin")).status).toBe(404);
    actor.value = { id: akmal.id };
    expect((await get("?as=admin")).status).toBe(404);
    expect((await names("")).sort()).toEqual(["Aziz Tursunov/Akmal Karimov", "Malika Saidova/Akmal Karimov"]);
  });
});

describe("GET /api/v1/log-mentors", () => {
  const list = (query = "") => logMentors(new Request(`http://test/api/v1/log-mentors${query}`));

  it("answers 401, 403 inactive, and 404 to a reader who may change no program", async () => {
    expect((await list()).status).toBe(401);
    const { ga } = await school();
    const leader = await admin("Lola Leader");
    await grant({ userId: leader.id, programId: ga.id, role: "LEADER" });
    actor.value = { id: leader.id };
    expect((await list()).status).toBe(404);
    const pending = await student({ status: "PENDING" });
    actor.value = { id: pending.userId };
    expect((await (await list()).json()).code).toBe("inactive");
  });

  it("lists the mentors of the reader's programs by name, narrowed by program", async () => {
    const { akmal, masters, nodira } = await school();
    actor.value = { id: nodira.id };
    expect(await (await list()).json()).toEqual([{ id: akmal.id, name: "Akmal Karimov" }]);
    expect(await (await list(`?program=${masters.id}`)).json()).toEqual([]);
  });
});
