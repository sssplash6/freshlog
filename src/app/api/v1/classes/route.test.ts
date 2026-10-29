import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, allocation, grant, mentor, pairing, program, student } from "@/test/db";

/** Classes: the website's diary for whoever works in a program that schedules them, and nobody else. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const diary = await import("@/app/api/v1/classes/route");
const cancel = await import("@/app/api/v1/classes/[id]/cancel/route");
const held = await import("@/app/api/v1/classes/[id]/held/route");
const me = await import("@/app/api/v1/me/route");

const get = (month = "") => diary.GET(new Request(`http://test/api/v1/classes${month ? `?month=${month}` : ""}`));
const json = (body: unknown) => new Request("http://test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  actor.value = null;
});

describe("classes", () => {
  it("is a 404 until a program the reader works in schedules them, and /me says when it isn't", async () => {
    const sat = await program("SAT Department");
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: sat.id });
    actor.value = { id: m.id };
    expect((await get()).status).toBe(404);
    expect((await (await me.GET()).json()).classes).toBe(false);
    await prisma.program.update({ where: { id: sat.id }, data: { schedulesClasses: true } });
    expect((await get()).status).toBe(200);
    expect((await (await me.GET()).json()).classes).toBe(true);
  });

  it("books a class out of a student's hours, lists it in the month, and lets its mentor or an admin cancel it", async () => {
    const sat = await program("SAT Department");
    await prisma.program.update({ where: { id: sat.id }, data: { schedulesClasses: true } });
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: sat.id });
    const aziz = await student({ programId: sat.id, name: "Aziz Tursunov" });
    await allocation({ studentId: aziz.id, mentorId: m.id, minutes: 300, deadlineInDays: 60 });
    actor.value = { id: m.id };
    const before = await (await get()).json();
    expect(before).toMatchObject({ book: true, staff: false, diary: [], students: [] });
    expect(before.targets).toMatchObject([{ student: aziz.id, program: sat.id, name: "Aziz Tursunov", hint: "SAT Department · 5h unreserved" }]);

    // Tomorrow: a class can't start in the past, whatever Tashkent's clock says now.
    const day = new Date(Date.parse(`${before.today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect((await (await diary.POST(json({ student: aziz.id, program: sat.id, day, time: "9am", minutes: 60 }))).json()).field).toBe("time");
    const booked = await (await diary.POST(json({ student: aziz.id, program: sat.id, day, time: "23:30", minutes: 90, topic: "Reading" }))).json();
    expect(booked).toMatchObject({ ok: true });
    expect(await (await diary.POST(json({ student: aziz.id, program: sat.id, day, time: "23:00", minutes: 600 }))).json()).toMatchObject({ ok: false });

    const after = await (await get()).json();
    expect(after.diary).toMatchObject([{ student: { id: aziz.id }, mentor: null, day, time: "23:30", minutes: 90, topic: "Reading", status: "SCHEDULED", can: { cancel: true } }]);
    expect(after.students).toMatchObject([{ student: { id: aziz.id, name: "Aziz Tursunov" }, classes: 1, booked: 90, held: 0, total: 90 }]);

    // Not started yet, so not held; a stranger can't cancel it; its mentor can.
    expect(await (await held.POST(json({}), ctx(after.diary[0].id))).json()).toMatchObject({ ok: false });
    const nodira = await admin("Nodira Aliyeva");
    await grant({ userId: nodira.id, programId: sat.id, role: "LEADER" });
    actor.value = { id: nodira.id };
    const leader = await (await get()).json();
    expect(leader).toMatchObject({ staff: true, book: false });
    expect(leader.diary[0]).toMatchObject({ mentor: { name: "Akmal Karimov" }, can: { cancel: false } });
    actor.value = { id: m.id };
    expect(await (await cancel.POST(json({}), ctx(after.diary[0].id))).json()).toMatchObject({ ok: true });
    expect((await (await get()).json()).diary[0].status).toBe("CANCELLED");
  });
});
