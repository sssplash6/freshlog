import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, cohort, grant, level, mentor, pairing, program, student } from "@/test/db";

/** Mentors from the admin's side: registering one, a program's pairings, and its tasks for mentors. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const register = (await import("@/app/api/v1/mentors/route")).POST;
const assign = (await import("@/app/api/v1/programs/[id]/mentors/route")).POST;
const unpair = (await import("@/app/api/v1/programs/[id]/mentors/[pairingId]/route")).DELETE;
const tasks = await import("@/app/api/v1/programs/[id]/mentor-tasks/route");
const withdraw = (await import("@/app/api/v1/programs/[id]/mentor-tasks/[taskId]/route")).DELETE;

const req = (method: string, body?: unknown) =>
  new Request("http://test", { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

beforeEach(() => {
  actor.value = null;
});

async function setUp() {
  const p = await program("Global Admissions");
  const akmal = await mentor("Akmal Karimov");
  const umid = await mentor("Umid Rashidov");
  await pairing({ mentorId: akmal.id, programId: p.id });
  await pairing({ mentorId: umid.id, programId: p.id });
  const aziz = await student({ programId: p.id, name: "Aziz Tursunov" });
  const nodira = await admin("Nodira Aliyeva");
  await grant({ userId: nodira.id, programId: p.id });
  const leader = await admin("Lola Leader");
  await grant({ userId: leader.id, programId: p.id, role: "LEADER" });
  return { p, akmal, umid, aziz, nodira, leader };
}

describe("POST /api/v1/mentors", () => {
  const newMentor = (targets: unknown) => ({ firstName: "Kamola", lastName: "Usmonova", email: "kamola@test.invalid", targets });

  it("answers 401, and registers a mentor where the body says", async () => {
    expect((await register(req("POST", {}))).status).toBe(401);
    const { p, nodira } = await setUp();
    const lvl = await level({ programId: p.id, name: "Emerging" });
    actor.value = { id: nodira.id };
    const res = await register(req("POST", newMentor([{ level: lvl.id }])));
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/Kamola Usmonova/);
    const kamola = await prisma.user.findUniqueOrThrow({ where: { email: "kamola@test.invalid" }, include: { mentorAssignments: true } });
    expect(kamola).toMatchObject({ role: "MENTOR", name: "Kamola Usmonova" });
    expect(kamola.mentorAssignments).toEqual([expect.objectContaining({ programId: p.id, levelId: lvl.id })]);
  });

  it("registers several at once into the same programs, skipping and naming a row it can't take, as the website's list", async () => {
    const { p, nodira, aziz } = await setUp();
    const taken = (await prisma.user.findUniqueOrThrow({ where: { id: aziz.userId } })).email;
    actor.value = { id: nodira.id };
    const res = await register(
      req("POST", {
        mentors: [
          { firstName: "Kamola", lastName: "Usmonova", email: "kamola@test.invalid" },
          { firstName: "Bobur", lastName: "Aliev", email: "bobur@test.invalid" },
          { firstName: "Solo", lastName: "", email: "solo@test.invalid" },
          { firstName: "Taken", lastName: "Already", email: taken },
        ],
        targets: [{ program: p.id }],
      })
    );
    expect(res.status).toBe(200);
    const { message } = await res.json();
    expect(message).toMatch(/solo@test\.invalid/);
    for (const email of ["kamola@test.invalid", "bobur@test.invalid"]) {
      const m = await prisma.user.findUniqueOrThrow({ where: { email }, include: { mentorAssignments: true } });
      expect(m.mentorAssignments.map((a) => a.programId)).toEqual([p.id]);
    }
    expect(await prisma.user.findUnique({ where: { email: "solo@test.invalid" } })).toBeNull();
  });

  it("refuses a list that isn't one, and a Leader, who may not place anybody", async () => {
    const { p, nodira, leader } = await setUp();
    actor.value = { id: nodira.id };
    expect((await (await register(req("POST", { mentors: [], targets: [{ program: p.id }] }))).json()).field).toBe("mentors");
    expect((await (await register(req("POST", { mentors: [{ email: "x@test.invalid" }], targets: [{ program: p.id }] }))).json()).field).toBe("mentors");
    actor.value = { id: leader.id };
    expect((await register(req("POST", { mentors: [{ firstName: "A", lastName: "B", email: "ab@test.invalid" }], targets: [{ program: p.id }] }))).status).toBe(403);
  });

  it("refuses an email that is already a student's, in the action's words", async () => {
    const { aziz, nodira } = await setUp();
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: aziz.userId } })).email;
    actor.value = { id: nodira.id };
    const res = await register(req("POST", { ...newMentor([]), email, targets: [{ program: (await prisma.program.findFirstOrThrow()).id }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already a student/);
  });

  it("a target outside the reader's programs is a 404, a Leader's a 403, bad fields named", async () => {
    const { p, nodira, leader } = await setUp();
    const other = await program("Other");
    const c = await cohort({ programId: other.id });
    actor.value = { id: nodira.id };
    expect((await register(req("POST", newMentor([{ cohort: c.id }])))).status).toBe(404);
    expect((await register(req("POST", newMentor([{ program: "c-made-up" }])))).status).toBe(404);
    expect((await (await register(req("POST", newMentor([])))).json()).field).toBe("targets");
    expect((await (await register(req("POST", { ...newMentor([{ program: p.id }]), lastName: " " }))).json()).field).toBe("lastName");
    actor.value = { id: leader.id };
    expect((await register(req("POST", newMentor([{ program: p.id }])))).status).toBe(403);
    expect(await prisma.user.count({ where: { email: "kamola@test.invalid" } })).toBe(0);
  });
});

describe("a program's mentors", () => {
  it("assigns a mentor, says so again the second time, and removes the pairing", async () => {
    const { p, nodira } = await setUp();
    const kamola = await mentor("Kamola Usmonova");
    actor.value = { id: nodira.id };
    expect((await assign(req("POST", { mentor: kamola.id }), ctx({ id: p.id }))).status).toBe(200);
    const again = await assign(req("POST", { mentor: kamola.id }), ctx({ id: p.id }));
    expect(again.status).toBe(200);
    expect((await again.json()).message).toMatch(/already assigned/);
    const pairingRow = await prisma.mentorAssignment.findFirstOrThrow({ where: { mentorId: kamola.id } });
    expect((await unpair(req("DELETE"), ctx({ id: p.id, pairingId: pairingRow.id }))).status).toBe(200);
    expect(await prisma.mentorAssignment.count({ where: { mentorId: kamola.id } })).toBe(0);
  });

  it("a pairing of another program is a 404, and a Leader gets a 403", async () => {
    const { p, nodira, leader, akmal } = await setUp();
    const other = await program("Other");
    const theirs = await pairing({ mentorId: akmal.id, programId: other.id });
    actor.value = { id: nodira.id };
    expect((await unpair(req("DELETE"), ctx({ id: p.id, pairingId: theirs.id }))).status).toBe(404);
    actor.value = { id: leader.id };
    expect((await assign(req("POST", { mentor: akmal.id }), ctx({ id: p.id }))).status).toBe(403);
    const mine = await prisma.mentorAssignment.findFirstOrThrow({ where: { programId: p.id } });
    expect((await unpair(req("DELETE"), ctx({ id: p.id, pairingId: mine.id }))).status).toBe(403);
  });
});

describe("a program's tasks for mentors", () => {
  const list = async (id: string) => (await tasks.GET(req("GET"), ctx({ id }))).json();

  it("sets one for the whole team, lists open ones first, and withdraws it", async () => {
    const { p, akmal, umid, aziz, nodira } = await setUp();
    actor.value = { id: nodira.id };
    const res = await tasks.POST(req("POST", { title: "Update booking links", due: "2027-01-10", mentors: [akmal.id, umid.id], about: [aziz.id] }), ctx({ id: p.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/whole team/);
    await tasks.POST(req("POST", { title: "Earlier", due: "2027-01-05", mentors: [akmal.id] }), ctx({ id: p.id }));
    const done = await tasks.POST(req("POST", { title: "Already done", due: "2027-01-01", mentors: [umid.id] }), ctx({ id: p.id }));
    expect(done.status).toBe(200);
    await prisma.mentorTaskAssignee.updateMany({ where: { task: { title: "Already done" } }, data: { completedAt: new Date() } });
    const body = await list(p.id);
    expect(body.items.map((t: { title: string; done: boolean }) => [t.title, t.done])).toEqual([
      ["Earlier", false],
      ["Update booking links", false],
      ["Already done", true],
    ]);
    expect(body.items[1]).toMatchObject({
      due: "2027-01-10",
      overdue: false,
      createdBy: { id: nodira.id, name: "Nodira Aliyeva" },
      about: [{ id: aziz.id, userId: aziz.userId, name: "Aziz Tursunov" }],
    });
    expect(body.team.map((m: { name: string }) => m.name)).toEqual(["Akmal Karimov", "Umid Rashidov"]);
    expect(body.can).toEqual({ write: true });
    const id = body.items[1].id;
    expect((await withdraw(req("DELETE"), ctx({ id: p.id, taskId: id }))).status).toBe(200);
    expect(await prisma.mentorTask.count({ where: { id } })).toBe(0);
  });

  it("names the field: a mentor off the team, a student outside the program, a day that isn't one", async () => {
    const { p, akmal, nodira } = await setUp();
    const stranger = await mentor("Stranger");
    const elsewhere = await student({ name: "Sitora Nazarova" });
    actor.value = { id: nodira.id };
    const post = async (body: unknown) => (await (await tasks.POST(req("POST", body), ctx({ id: p.id }))).json()).field;
    const good = { title: "Links", due: "2027-01-10", mentors: [akmal.id] };
    expect(await post({ ...good, mentors: [stranger.id] })).toBe("mentors");
    expect(await post({ ...good, mentors: [] })).toBe("mentors");
    expect(await post({ ...good, about: [elsewhere.id] })).toBe("about");
    expect(await post({ ...good, due: "2027-02-30" })).toBe("due");
    expect(await post({ ...good, title: "x".repeat(121) })).toBe("title");
    expect(await prisma.mentorTask.count()).toBe(0);
  });

  it("a Leader reads them and may not set or withdraw one; another program's task is a 404", async () => {
    const { p, akmal, nodira, leader } = await setUp();
    const other = await program("Other");
    const otherBoss = await admin("Other Boss");
    await grant({ userId: otherBoss.id, programId: other.id });
    const theirs = await prisma.mentorTask.create({ data: { programId: other.id, title: "Theirs", dueOn: new Date("2027-01-01"), createdById: otherBoss.id } });
    actor.value = { id: nodira.id };
    expect((await withdraw(req("DELETE"), ctx({ id: p.id, taskId: theirs.id }))).status).toBe(404);
    expect((await tasks.GET(req("GET"), ctx({ id: other.id }))).status).toBe(404);
    actor.value = { id: leader.id };
    expect((await list(p.id)).can).toEqual({ write: false });
    expect((await tasks.POST(req("POST", { title: "Links", due: "2027-01-10", mentors: [akmal.id] }), ctx({ id: p.id }))).status).toBe(403);
  });
});
