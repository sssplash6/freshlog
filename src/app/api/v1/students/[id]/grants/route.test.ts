import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, allocation, grant, mentor, pairing, program, session, student } from "@/test/db";

/**
 * A student's time: the grant sheet's options, a grant or a correction, a move
 * between mentors, and a removal. The website's actions, behind the admin's gate.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const options = (await import("@/app/api/v1/students/[id]/grant-options/route")).GET;
const grantRoute = (await import("@/app/api/v1/students/[id]/grants/route")).POST;
const transferRoute = (await import("@/app/api/v1/students/[id]/grants/transfer/route")).POST;
const removeRoute = (await import("@/app/api/v1/students/[id]/grants/remove/route")).POST;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (route: typeof grantRoute, id: string, body: unknown) =>
  route(new Request("http://test", { method: "POST", body: JSON.stringify(body) }), ctx(id));
const getOptions = (id: string) => options(new Request("http://test"), ctx(id));

const DAY = "2027-03-01";

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
  return { p, akmal, umid, aziz, nodira };
}

const grantsOf = (studentId: string) =>
  prisma.hourAllocation.findMany({ where: { studentId }, orderBy: { createdAt: "asc" } });

describe("GET /api/v1/students/:id/grant-options", () => {
  it("answers 401, 403 inactive, 404 alike for not yours and missing, and 403 to a Leader", async () => {
    expect((await getOptions("x")).status).toBe(401);
    const { p, aziz } = await setUp();
    const pending = await student({ status: "PENDING" });
    actor.value = { id: pending.userId };
    expect((await (await getOptions(aziz.id)).json()).code).toBe("inactive");
    const other = await admin("Elsewhere");
    await grant({ userId: other.id, programId: (await program("Other")).id });
    actor.value = { id: other.id };
    const theirs = await getOptions(aziz.id);
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toEqual(await (await getOptions("c-made-up")).json());
    const leader = await admin("Lola Leader");
    await grant({ userId: leader.id, programId: p.id, role: "LEADER" });
    actor.value = { id: leader.id };
    expect((await getOptions(aziz.id)).status).toBe(403);
  });

  it("offers the student's programs, their mentors and open plan items", async () => {
    const { p, akmal, aziz, nodira } = await setUp();
    await prisma.program.update({ where: { id: p.id }, data: { standardMinutes: 600, standardDays: 90 } });
    actor.value = { id: nodira.id };
    const body = await (await getOptions(aziz.id)).json();
    expect(body.programs).toEqual([
      expect.objectContaining({ id: p.id, tracksPayment: false, bankAllowed: false, bank: null, askPast: false, standard: { minutes: 600, days: 90 } }),
    ]);
    expect(body.mentors.map((m: { mentor: { name: string } }) => m.mentor.name)).toEqual(["Akmal Karimov", "Umid Rashidov"]);
    expect(body.mentors[0]).toEqual({ mentor: { id: akmal.id, name: "Akmal Karimov" }, programIds: [p.id] });
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("POST /api/v1/students/:id/grants", () => {
  it("answers 401, 404 for a student or program the reader does not read, and 403 to a Leader", async () => {
    expect((await post(grantRoute, "x", {})).status).toBe(401);
    const { p, akmal, aziz } = await setUp();
    const leader = await admin("Lola Leader");
    await grant({ userId: leader.id, programId: p.id, role: "LEADER" });
    actor.value = { id: leader.id };
    const res = await post(grantRoute, aziz.id, { program: p.id, mentor: akmal.id, mode: "add", minutes: 60, deadline: DAY });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("You don't administer that program.");
    const nodira2 = await admin("Two Programs");
    await grant({ userId: nodira2.id, programId: p.id });
    actor.value = { id: nodira2.id };
    const elsewhere = await post(grantRoute, aziz.id, { program: (await program("Not Mine")).id, mentor: akmal.id, mode: "add", minutes: 60, deadline: DAY });
    expect(elsewhere.status).toBe(404);
    expect(await grantsOf(aziz.id)).toEqual([]);
  });

  it("refuses each bad value on its field", async () => {
    const { p, akmal, aziz, nodira } = await setUp();
    actor.value = { id: nodira.id };
    const good = { program: p.id, mentor: akmal.id, mode: "add", minutes: 60, deadline: DAY };
    for (const [change, field] of [
      [{ mentor: "stranger" }, "mentor"],
      [{ mode: "more" }, "mode"],
      [{ minutes: 0 }, "minutes"],
      [{ minutes: 1.5 }, "minutes"],
      [{ deadline: "2027-02-31" }, "deadline"],
      [{ amountPaid: 100 }, "amountPaid"],
      [{ bank: true, mentor: null }, "bank"],
      [{ task: { purpose: "x".repeat(101) } }, "task.purpose"],
      [{ task: { purpose: "Essay", note: "x".repeat(501) } }, "task.note"],
      [{ task: { planItem: "nope" } }, "task"],
    ] as const) {
      const res = await post(grantRoute, aziz.id, { ...good, ...change });
      expect([res.status, (await res.json()).field]).toEqual([400, field]);
    }
    expect(await grantsOf(aziz.id)).toEqual([]);
  });

  it("adds, then sets, and names a new plan item for the time", async () => {
    const { p, akmal, aziz, nodira } = await setUp();
    actor.value = { id: nodira.id };
    const add = await post(grantRoute, aziz.id, { program: p.id, mentor: akmal.id, mode: "add", minutes: 120, deadline: DAY, task: { purpose: "Personal statement", note: "Two drafts." } });
    expect(add.status).toBe(200);
    expect((await add.json()).message).toMatch(/Akmal/);
    expect(await grantsOf(aziz.id)).toEqual([expect.objectContaining({ mentorId: akmal.id, minutes: 120 })]);
    const item = await prisma.assignment.findFirstOrThrow({ where: { studentId: aziz.id } });
    expect(item).toMatchObject({ purpose: "Personal statement", minuteLimit: 120, note: "Two drafts.", mentorId: akmal.id });
    expect((await post(grantRoute, aziz.id, { program: p.id, mentor: akmal.id, mode: "add", minutes: 60, deadline: DAY, task: { planItem: item.id } })).status).toBe(200);
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: item.id } })).minuteLimit).toBe(180);
    expect((await post(grantRoute, aziz.id, { program: p.id, mentor: akmal.id, mode: "set", minutes: 90, deadline: DAY })).status).toBe(200);
    expect((await grantsOf(aziz.id))[0].minutes).toBe(90);
  });

  it("asks for what was paid where the program bills per student", async () => {
    const { p, akmal, aziz, nodira } = await setUp();
    await prisma.program.update({ where: { id: p.id }, data: { tracksPayment: true } });
    actor.value = { id: nodira.id };
    const missing = await post(grantRoute, aziz.id, { program: p.id, mentor: akmal.id, mode: "add", minutes: 60, deadline: DAY });
    expect((await missing.json()).field).toBe("amountPaid");
    expect((await post(grantRoute, aziz.id, { program: p.id, mentor: akmal.id, mode: "add", minutes: 60, deadline: DAY, amountPaid: 49.5 })).status).toBe(200);
    expect((await grantsOf(aziz.id))[0].amountPaid).toBe(49.5);
  });

  it("fills a bank, asking about past hours only when there are some, then shares it, never past what is left", async () => {
    const { p, akmal, aziz, nodira } = await setUp();
    await prisma.program.update({ where: { id: p.id }, data: { hourBank: true } });
    await allocation({ studentId: aziz.id, mentorId: akmal.id, minutes: 60 });
    actor.value = { id: nodira.id };
    expect((await (await getOptions(aziz.id)).json()).programs[0]).toMatchObject({ bankAllowed: true, askPast: true, bank: null });
    const bank = { program: p.id, mentor: null, bank: true, mode: "add", minutes: 600, deadline: DAY };
    expect((await (await post(grantRoute, aziz.id, bank)).json()).field).toBe("includePrevious");
    expect((await post(grantRoute, aziz.id, { ...bank, includePrevious: false })).status).toBe(200);
    expect((await (await getOptions(aziz.id)).json()).programs[0]).toMatchObject({ askPast: false, bank: { left: 600, deadline: DAY } });
    const over = await post(grantRoute, aziz.id, { program: p.id, mentor: akmal.id, mode: "set", minutes: 700, deadline: DAY });
    expect(over.status).toBe(400);
    expect((await prisma.hourAllocation.findFirstOrThrow({ where: { studentId: aziz.id, isBank: true } })).minutes).toBe(600);
  });
});

describe("POST /api/v1/students/:id/grants/transfer", () => {
  it("moves only unused minutes, and a grant that is not there is a 404", async () => {
    const { p, akmal, umid, aziz, nodira } = await setUp();
    await allocation({ studentId: aziz.id, mentorId: akmal.id, minutes: 180 });
    await session({ studentId: aziz.id, mentorId: akmal.id, minutes: 60 });
    actor.value = { id: nodira.id };
    const tooMuch = await post(transferRoute, aziz.id, { program: p.id, from: akmal.id, to: umid.id, minutes: 150, moveTasks: true });
    expect(tooMuch.status).toBe(400);
    const res = await post(transferRoute, aziz.id, { program: p.id, from: akmal.id, to: umid.id, minutes: 120, moveTasks: true });
    expect(res.status).toBe(200);
    expect((await grantsOf(aziz.id)).map((g) => [g.mentorId, g.minutes])).toEqual([[akmal.id, 60], [umid.id, 120]]);
    const gone = await post(transferRoute, aziz.id, { program: p.id, from: null, to: umid.id, minutes: 10, moveTasks: false });
    expect(gone.status).toBe(404);
    expect((await (await post(transferRoute, aziz.id, { program: p.id, from: akmal.id, to: umid.id, minutes: 10 })).json()).field).toBe("moveTasks");
  });
});

describe("POST /api/v1/students/:id/grants/remove", () => {
  it("is refused while sessions stand, and removes a grant that has none", async () => {
    const { p, akmal, umid, aziz, nodira } = await setUp();
    await allocation({ studentId: aziz.id, mentorId: akmal.id, minutes: 180 });
    await allocation({ studentId: aziz.id, mentorId: umid.id, minutes: 60 });
    await session({ studentId: aziz.id, mentorId: akmal.id, minutes: 60 });
    actor.value = { id: nodira.id };
    expect((await post(removeRoute, aziz.id, { program: p.id, mentor: akmal.id })).status).toBe(400);
    expect((await post(removeRoute, aziz.id, { program: p.id, mentor: umid.id })).status).toBe(200);
    expect((await grantsOf(aziz.id)).map((g) => g.mentorId)).toEqual([akmal.id]);
  });

  it("gives a Leader a 403 and changes nothing", async () => {
    const { p, akmal, aziz } = await setUp();
    await allocation({ studentId: aziz.id, mentorId: akmal.id, minutes: 180 });
    const leader = await admin("Lola Leader");
    await grant({ userId: leader.id, programId: p.id, role: "SALES" });
    actor.value = { id: leader.id };
    expect((await post(removeRoute, aziz.id, { program: p.id, mentor: akmal.id })).status).toBe(403);
    expect(await grantsOf(aziz.id)).toHaveLength(1);
  });
});
