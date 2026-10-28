import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, assignment, DAY, grant, mentor, pairing, program, session, student, studentTask } from "@/test/db";

/**
 * Who may read one task or one plan item, what each of them is told about it,
 * and what they may do to it. The rules are the website's: `/students/[id]`
 * decides who reads, and `assertTaskScope` decides who changes.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { readerFor } = await import("@/lib/api/v1/sessions");
const { planItemFor, taskFor } = await import("@/lib/api/v1/work");

const asReader = async (userId: string) =>
  readerFor(await prisma.user.findUniqueOrThrow({ where: { id: userId } }));

/** A student in a program an admin runs, with a task their mentor set. Due 2026-11-03. */
async function world() {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id, name: "Aziz Karimov" });
  const m = await mentor("Akmal Karimov");
  await pairing({ mentorId: m.id, programId: p.id });
  const a = await admin("Dilnoza");
  await grant({ userId: a.id, programId: p.id });
  const t = await prisma.studentTask.update({
    where: { id: (await studentTask({ studentId: st.id, mentorId: m.id, programId: p.id })).id },
    data: { dueOn: new Date("2026-11-03T00:00:00.000Z"), note: "Cut it to 650 words." },
  });
  return { p, st, m, a, t };
}

const NOW = new Date("2026-10-24T08:00:00.000Z");

describe("taskFor", () => {
  it("a task's student, its mentor and an admin of its program read it; another mentor and a stranger get null", async () => {
    const { st, m, a, t } = await world();
    const other = await mentor("Umid Rashidov");
    const stranger = await student({ name: "Stranger" });
    for (const userId of [st.userId, m.id, a.id]) {
      expect(await taskFor(await asReader(userId), t.id, NOW)).toMatchObject({ id: t.id, title: "Rewrite the draft" });
    }
    for (const userId of [other.id, stranger.userId]) {
      expect(await taskFor(await asReader(userId), t.id, NOW)).toBeNull();
    }
    expect(await taskFor(await asReader(m.id), "c-made-up", NOW)).toBeNull();
  });

  it("a mentor who reaches the student reads a task another mentor set, with can.edit false", async () => {
    const { p, t } = await world();
    const other = await mentor("Umid Rashidov");
    await pairing({ mentorId: other.id, programId: p.id });
    const read = await taskFor(await asReader(other.id), t.id, NOW);
    expect(read).toMatchObject({ id: t.id, mentor: { name: "Akmal Karimov" }, can: { progress: false, edit: false, delete: false } });
  });

  it("a task due today reads daysLeft 0, and overdue once the day has begun (freshform's TASK_OVERDUE rule)", async () => {
    const { m, t } = await world();
    const reader = await asReader(m.id);
    // 2026-11-03 is stored at UTC midnight: 05:00 Tashkent. Before that it has not begun.
    const before = await taskFor(reader, t.id, new Date("2026-11-02T23:59:00.000Z"));
    expect(before).toMatchObject({ daysLeft: 0, overdue: false });
    const begun = await taskFor(reader, t.id, new Date("2026-11-03T00:00:01.000Z"));
    expect(begun).toMatchObject({ daysLeft: 0, overdue: true });
    const later = await taskFor(reader, t.id, new Date("2026-11-05T09:00:00.000Z"));
    expect(later).toMatchObject({ daysLeft: -2, overdue: true });
    // Done is never overdue.
    await prisma.studentTask.update({ where: { id: t.id }, data: { completedAt: new Date(), percent: 100 } });
    expect(await taskFor(reader, t.id, new Date("2026-11-05T09:00:00.000Z"))).toMatchObject({
      overdue: false,
      done: true,
      percent: 100,
    });
  });

  it('a due day round-trips: dueOn 2026-11-03T00:00Z reads "2026-11-03"', async () => {
    const { m, t } = await world();
    expect((await taskFor(await asReader(m.id), t.id, NOW))?.due).toBe("2026-11-03");
  });

  it("can on a task: student {progress:true, edit:false, delete:false}; owning mentor all true; an admin of another program reads null", async () => {
    const { st, m, a, t } = await world();
    expect((await taskFor(await asReader(st.userId), t.id, NOW))?.can).toEqual({
      progress: true,
      edit: false,
      delete: false,
    });
    expect((await taskFor(await asReader(m.id), t.id, NOW))?.can).toEqual({ progress: true, edit: true, delete: true });
    // An admin of the task's program may change it.
    expect((await taskFor(await asReader(a.id), t.id, NOW))?.can).toEqual({ progress: true, edit: true, delete: true });
    // An admin of a different program is no one to it.
    const p2 = await program("Master's Program");
    const a2 = await admin("Other admin");
    await grant({ userId: a2.id, programId: p2.id });
    expect(await taskFor(await asReader(a2.id), t.id, NOW)).toBeNull();
  });

  it("a read-only grant reads the task and may change nothing; the day-1 shape carries the student, mentor and program", async () => {
    const { p, t } = await world();
    const leader = await admin("Leader");
    await grant({ userId: leader.id, programId: p.id, role: "LEADER" });
    const read = await taskFor(await asReader(leader.id), t.id, NOW);
    expect(read).toMatchObject({
      student: { name: "Aziz Karimov" },
      program: { name: "Global Admissions" },
      mentor: { name: "Akmal Karimov" },
      note: "Cut it to 650 words.",
      percent: 0,
      completedAt: null,
      can: { progress: false, edit: false, delete: false },
    });
  });

  it("an inactive owning mentor may not change it", async () => {
    const { m, t } = await world();
    await prisma.user.update({ where: { id: m.id }, data: { status: "UNASSIGNED" } });
    expect((await taskFor(await asReader(m.id), t.id, NOW))?.can).toEqual({
      progress: false,
      edit: false,
      delete: false,
    });
  });
});

describe("planItemFor", () => {
  async function item() {
    const w = await world();
    const row = await assignment({ studentId: w.st.id, programId: w.p.id, mentorId: w.m.id, purpose: "Personal statement", minuteLimit: 120 });
    const a = await prisma.assignment.update({
      where: { id: row.id },
      data: { note: "Weak on structure.", dueNote: "March-May", dueOn: new Date("2026-03-10T00:00:00.000Z") },
    });
    return { ...w, a };
  }

  it("a student reads their own plan item with note null; its mentor reads the note", async () => {
    const { st, m, a } = await item();
    expect(await planItemFor(await asReader(st.userId), a.id, NOW)).toMatchObject({ purpose: "Personal statement", note: null });
    expect(await planItemFor(await asReader(m.id), a.id, NOW)).toMatchObject({ note: "Weak on structure." });
  });

  it("a student who also administers the program is still told no note", async () => {
    const { st, p, a } = await item();
    await prisma.user.update({ where: { id: st.userId }, data: { role: "ADMIN" } });
    await grant({ userId: st.userId, programId: p.id });
    const read = await planItemFor(await asReader(st.userId), a.id, NOW);
    expect(read).toMatchObject({ note: null });
  });

  it("another mentor outside the program, another student and a missing id read null", async () => {
    const { a } = await item();
    const outsider = await mentor("Outsider");
    const stranger = await student({ name: "Stranger" });
    expect(await planItemFor(await asReader(outsider.id), a.id, NOW)).toBeNull();
    expect(await planItemFor(await asReader(stranger.userId), a.id, NOW)).toBeNull();
    expect(await planItemFor(await asReader(outsider.id), "c-made-up", NOW)).toBeNull();
  });

  it("counts the minutes logged against it by every mentor, and never a voided session", async () => {
    const { st, m, p, a } = await item();
    const other = await mentor("Umid");
    await session({ studentId: st.id, programId: p.id, mentorId: m.id, minutes: 30, assignmentId: a.id });
    await session({ studentId: st.id, programId: p.id, mentorId: other.id, minutes: 45, assignmentId: a.id });
    await session({ studentId: st.id, programId: p.id, mentorId: m.id, minutes: 60, assignmentId: a.id, status: "VOIDED" });
    await session({ studentId: st.id, programId: p.id, mentorId: m.id, minutes: 15 });
    expect(await planItemFor(await asReader(m.id), a.id, NOW)).toMatchObject({
      minuteLimit: 120,
      loggedMinutes: 75,
    });
  });

  it("reads its due day, due note, pin and overdue rule; a done item is never overdue", async () => {
    const { m, a } = await item();
    const reader = await asReader(m.id);
    expect(await planItemFor(reader, a.id, NOW)).toMatchObject({
      due: "2026-03-10",
      dueNote: "March-May",
      progress: "NOT_STARTED",
      pinned: false,
      overdue: true,
      mentor: { name: "Akmal Karimov" },
    });
    await prisma.assignment.update({ where: { id: a.id }, data: { progress: "DONE", progressManual: true } });
    expect(await planItemFor(reader, a.id, NOW)).toMatchObject({ progress: "DONE", pinned: true, overdue: false });
    await prisma.assignment.update({ where: { id: a.id }, data: { dueOn: new Date(NOW.getTime() + DAY), progress: "NOT_STARTED" } });
    expect((await planItemFor(reader, a.id, NOW))?.overdue).toBe(false);
  });

  it("an item nobody is chosen for has mentor null; can follows assertTaskScope", async () => {
    const { st, m, a, p } = await item();
    await prisma.assignment.update({ where: { id: a.id }, data: { mentorId: null } });
    const read = await planItemFor(await asReader(m.id), a.id, NOW);
    expect(read).toMatchObject({ mentor: null, can: { edit: false, progress: false } });
    // The owning mentor may; a student may not.
    await prisma.assignment.update({ where: { id: a.id }, data: { mentorId: m.id } });
    // Deleting is the admin's alone (`deleteAssignment`), never the owning mentor's.
    expect((await planItemFor(await asReader(m.id), a.id, NOW))?.can).toEqual({ edit: true, progress: true, delete: false });
    expect((await planItemFor(await asReader(st.userId), a.id, NOW))?.can).toEqual({ edit: false, progress: false, delete: false });
    const adm = await admin("Admin");
    await grant({ userId: adm.id, programId: p.id });
    expect((await planItemFor(await asReader(adm.id), a.id, NOW))?.can).toEqual({ edit: true, progress: true, delete: true });
  });
});
