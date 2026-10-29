import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { programToday as programTodayIso } from "@/lib/when";
import { admin, assignment, grant, mentor, pairing, program, student } from "@/test/db";

/**
 * One plan item. A student reads their own and is never told its note, which is
 * the staff's; anybody else's answers exactly like an id that was never made.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET, PATCH, DELETE } = await import("@/app/api/v1/plan-items/[id]/route");

const get = (id: string) => GET(new Request("http://test"), { params: Promise.resolve({ id }) });

const patch = (id: string, body: unknown) =>
  PATCH(
    new Request("http://test", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) }
  );

const stored = (id: string) => prisma.assignment.findUniqueOrThrow({ where: { id } });

async function setUp(studentStatus?: string) {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id, status: studentStatus });
  const m = await mentor("Akmal Karimov");
  await pairing({ mentorId: m.id, programId: p.id });
  const row = await assignment({ studentId: st.id, programId: p.id, mentorId: m.id, purpose: "Personal statement" });
  const a = await prisma.assignment.update({ where: { id: row.id }, data: { note: "Weak on structure." } });
  return { p, st, m, a };
}

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/plan-items/:id", () => {
  it("answers 401 with no user", async () => expect((await get("x")).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    const { st, a } = await setUp("PENDING");
    actor.value = { id: st.userId };
    const res = await get(a.id);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("another student's plan item answers like a missing one", async () => {
    const { a } = await setUp();
    const other = await student({ name: "Other Student" });
    actor.value = { id: other.userId };
    const theirs = await get(a.id);
    const missing = await get("c-made-up");
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
  });

  it("a student's plan item answer carries no note", async () => {
    const { st, a } = await setUp();
    actor.value = { id: st.userId };
    const res = await get(a.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item).toMatchObject({ id: a.id, purpose: "Personal statement", note: null });
    expect(JSON.stringify(body)).not.toContain("Weak on structure.");
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("answers the mentor with the note", async () => {
    const { m, a } = await setUp();
    actor.value = { id: m.id };
    const body = await (await get(a.id)).json();
    expect(body.item).toMatchObject({ note: "Weak on structure.", can: { edit: true, progress: true } });
  });
});

describe("PATCH /api/v1/plan-items/:id", () => {
  it("answers 401 with no user", async () => expect((await patch("x", { purpose: "A" })).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    const { st, a } = await setUp("PENDING");
    actor.value = { id: st.userId };
    const res = await patch(a.id, { purpose: "A" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("another student's plan item answers like a missing one", async () => {
    const { a } = await setUp();
    actor.value = { id: (await student({ name: "Other Student" })).userId };
    const theirs = await patch(a.id, { purpose: "Hijacked" });
    const missing = await patch("c-made-up", { purpose: "Hijacked" });
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect((await stored(a.id)).purpose).toBe("Personal statement");
  });

  it("the item's own student may see it and not change it: 403, nothing saved", async () => {
    const { st, a } = await setUp();
    actor.value = { id: st.userId };
    const res = await patch(a.id, { purpose: "Mine now" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("That plan item is not yours to change.");
    expect((await stored(a.id)).purpose).toBe("Personal statement");
  });

  it("a co-mentor who reaches the student may see it and not change it: 403, nothing saved", async () => {
    const { p, a } = await setUp();
    const co = await mentor("Umid Rashidov");
    await pairing({ mentorId: co.id, programId: p.id });
    actor.value = { id: co.id };
    expect((await get(a.id)).status).toBe(200);
    const res = await patch(a.id, { purpose: "Mine now" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("That plan item is not yours to change.");
    expect((await stored(a.id)).purpose).toBe("Personal statement");
  });

  it("changes what the body names and keeps the rest, the note and mentor included", async () => {
    const { m, a } = await setUp();
    await prisma.assignment.update({
      where: { id: a.id },
      data: { minuteLimit: 120, dueNote: "Early November", dueOn: new Date("2026-11-02T00:00:00.000Z"), progress: "IN_PROGRESS", progressManual: true },
    });
    actor.value = { id: m.id };
    const res = await patch(a.id, { minuteLimit: 90 });
    expect(res.status).toBe(200);
    expect(await stored(a.id)).toMatchObject({
      purpose: "Personal statement",
      minuteLimit: 90,
      dueNote: "Early November",
      dueOn: new Date("2026-11-02T00:00:00.000Z"),
      note: "Weak on structure.",
      mentorId: m.id,
      progress: "IN_PROGRESS",
      progressManual: true,
    });
  });

  it("clears with null and sets a day exactly as it was sent", async () => {
    const { m, a } = await setUp();
    actor.value = { id: m.id };
    expect((await patch(a.id, { note: null, due: "2026-12-31", minuteLimit: null })).status).toBe(200);
    expect(await stored(a.id)).toMatchObject({ note: null, dueOn: new Date("2026-12-31T00:00:00.000Z"), minuteLimit: null });
  });

  it("does not move the progress, nor the mentor by the website's field, whatever the body says", async () => {
    const { p, m, a } = await setUp();
    const other = await mentor("Umid Rashidov");
    await pairing({ mentorId: other.id, programId: p.id });
    actor.value = { id: m.id };
    const res = await patch(a.id, { purpose: "Statement", mentorId: other.id, progress: "DONE" });
    expect(res.status).toBe(200);
    expect(await stored(a.id)).toMatchObject({ purpose: "Statement", mentorId: m.id, progress: "NOT_STARTED" });
  });

  it("an admin of the program edits an item whose note they keep", async () => {
    const { p, m, a } = await setUp();
    const boss = await admin("Program Admin");
    await grant({ userId: boss.id, programId: p.id });
    actor.value = { id: boss.id };
    expect((await patch(a.id, { purpose: "Statement" })).status).toBe(200);
    expect(await stored(a.id)).toMatchObject({ purpose: "Statement", note: "Weak on structure.", mentorId: m.id });
  });

  it("refuses 2026-02-31 on due, a wrong type on its field, and a body that is no object", async () => {
    const { m, a } = await setUp();
    actor.value = { id: m.id };
    for (const [body, field] of [
      [{ due: "2026-02-31" }, "due"],
      [{ minuteLimit: "60" }, "minuteLimit"],
      [{ purpose: 5 }, "purpose"],
    ] as const) {
      const res = await patch(a.id, body);
      expect(res.status).toBe(400);
      expect((await res.json()).field).toBe(field);
    }
    expect((await patch(a.id, "nope")).status).toBe(400);
    expect(await stored(a.id)).toMatchObject({ dueOn: null, purpose: "Personal statement" });
  });

  it("passes the action's refusal on: an empty purpose is the website's words", async () => {
    const { m, a } = await setUp();
    actor.value = { id: m.id };
    const res = await patch(a.id, { purpose: "  " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/what these hours are for/);
  });
});

describe("a plan item's mentor, an admin's", () => {
  it("an admin of the program hands it to another of its mentors, telling both, and null takes it off everybody", async () => {
    const { p, m, a } = await setUp();
    const umid = await mentor("Umid Rashidov");
    await pairing({ mentorId: umid.id, programId: p.id });
    const boss = await admin("Program Admin");
    await grant({ userId: boss.id, programId: p.id });
    actor.value = { id: boss.id };
    expect((await patch(a.id, { mentor: umid.id })).status).toBe(200);
    expect((await stored(a.id)).mentorId).toBe(umid.id);
    expect(await prisma.notification.count({ where: { type: "GOAL_CHANGED", userId: { in: [m.id, umid.id] } } })).toBe(2);
    expect((await patch(a.id, { mentor: null })).status).toBe(200);
    expect((await stored(a.id)).mentorId).toBeNull();
  });

  it("offers an admin every mentor in the programs they run, as the student page's picker, and takes one from another of them", async () => {
    const { p, m, a } = await setUp();
    const imkon = await program("Imkon");
    const sardor = await mentor("Sardor Aliev");
    await pairing({ mentorId: sardor.id, programId: imkon.id });
    const boss = await admin("Program Admin");
    await grant({ userId: boss.id, programId: p.id });
    await grant({ userId: boss.id, programId: imkon.id });
    actor.value = { id: boss.id };
    const body = await (await get(a.id)).json();
    expect(body.mentorChoices.map((x: { name: string }) => x.name).sort()).toEqual(["Akmal Karimov", "Sardor Aliev"]);
    expect((await patch(a.id, { mentor: sardor.id })).status).toBe(200);
    expect((await stored(a.id)).mentorId).toBe(sardor.id);
    // The item's own mentor is offered no choices.
    actor.value = { id: m.id };
    expect((await (await get(a.id)).json()).mentorChoices).toEqual([]);
  });

  it("refuses a mentor in none of the admin's programs on its field", async () => {
    const { p, m, a } = await setUp();
    const stranger = await mentor("Stranger");
    const boss = await admin("Program Admin");
    await grant({ userId: boss.id, programId: p.id });
    actor.value = { id: boss.id };
    const res = await patch(a.id, { mentor: stranger.id });
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("mentor");
    expect((await stored(a.id)).mentorId).toBe(m.id);
  });

  it("gives the item's own mentor a 403 for naming one, and changes nothing", async () => {
    const { p, m, a } = await setUp();
    const umid = await mentor("Umid Rashidov");
    await pairing({ mentorId: umid.id, programId: p.id });
    actor.value = { id: m.id };
    const res = await patch(a.id, { mentor: umid.id });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("That plan item is not yours to change.");
    expect((await stored(a.id)).mentorId).toBe(m.id);
  });
});

describe("DELETE /api/v1/plan-items/:id", () => {
  const del = (id: string) => DELETE(new Request("http://test", { method: "DELETE" }), { params: Promise.resolve({ id }) });

  it("answers 401, the same 404 for not yours and missing, and a 403 to the item's own mentor", async () => {
    expect((await del("x")).status).toBe(401);
    const { m, a } = await setUp();
    actor.value = { id: (await student({ name: "Other Student" })).userId };
    expect(await (await del(a.id)).json()).toEqual(await (await del("c-made-up")).json());
    actor.value = { id: m.id };
    const res = await del(a.id);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("That plan item is not yours to change.");
    expect(await prisma.assignment.count({ where: { id: a.id } })).toBe(1);
  });

  it("deletes it for an admin of the program, who reads can.delete", async () => {
    const { p, a } = await setUp();
    const boss = await admin("Program Admin");
    await grant({ userId: boss.id, programId: p.id });
    actor.value = { id: boss.id };
    expect((await (await get(a.id)).json()).item.can).toEqual({ edit: true, progress: true, delete: true });
    expect((await del(a.id)).status).toBe(200);
    expect(await prisma.assignment.count({ where: { id: a.id } })).toBe(0);
  });

  it("says how many days are left to its due day, from freshform's day", async () => {
    const { m, a } = await setUp();
    actor.value = { id: m.id };
    expect((await (await get(a.id)).json()).item.daysLeft).toBeNull();
    await prisma.assignment.update({ where: { id: a.id }, data: { dueOn: new Date(`${programTodayIso()}T00:00:00.000Z`) } });
    expect((await (await get(a.id)).json()).item.daysLeft).toBe(0);
  });
});
