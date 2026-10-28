import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, assignment, enroll, grant, mentor, NOW, pairing, platformAdmin, program, session, student, studentTask } from "@/test/db";

/**
 * One student's tasks and plan items, for the person reading them. Who may read
 * follows `/students/[id]`: an admin of one of the student's programs (and then
 * only those programs' rows), or a mentor who reaches them (and then all of it).
 */
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { readerFor } = await import("@/lib/api/v1/sessions");
const { studentWorkFor } = await import("@/lib/api/v1/student-work");

const asReader = async (userId: string) =>
  readerFor(await prisma.user.findUniqueOrThrow({ where: { id: userId } }));

async function world() {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id, name: "Aziz Karimov" });
  const m = await mentor("Akmal Karimov");
  await pairing({ mentorId: m.id, programId: p.id });
  return { p, st, m };
}

describe("studentWorkFor", () => {
  it("a mentor who reaches the student reads their work; a stranger gets 404", async () => {
    const { p, st, m } = await world();
    const t = await studentTask({ studentId: st.id, mentorId: m.id, title: "Rewrite" });
    const a = await assignment({ studentId: st.id, mentorId: m.id, purpose: "Essay" });
    await prisma.assignment.update({ where: { id: a.id }, data: { note: "Staff note" } });

    // Another mentor of the program only reaches the student; they still read it all.
    const other = await mentor("Umid Rashidov");
    await pairing({ mentorId: other.id, programId: p.id });
    const read = await studentWorkFor(await asReader(other.id), st.id, NOW);
    expect(read).toMatchObject({
      student: { id: st.id, name: "Aziz Karimov" },
      tasks: [{ id: t.id, can: { progress: false, edit: false, delete: false } }],
      plan: [{ id: a.id, note: "Staff note", can: { edit: false, progress: false } }],
    });
    expect(read?.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const stranger = await mentor("Nobody");
    expect(await studentWorkFor(await asReader(stranger.id), st.id, NOW)).toBeNull();
    expect(await studentWorkFor(await asReader(other.id), "c-made-up", NOW)).toBeNull();
    // A student is not a reader of /students/[id]: their own page is their home.
    expect(await studentWorkFor(await asReader(st.userId), st.id, NOW)).toBeNull();
  });

  it("lists open tasks by due day before done ones, and plan items not done before done", async () => {
    const { st, m } = await world();
    const done = await studentTask({ studentId: st.id, mentorId: m.id, title: "Done", dueInDays: 1, completedAt: NOW, percent: 100 });
    const late = await studentTask({ studentId: st.id, mentorId: m.id, title: "Late", dueInDays: 9 });
    const soon = await studentTask({ studentId: st.id, mentorId: m.id, title: "Soon", dueInDays: 2 });
    const d = await assignment({ studentId: st.id, mentorId: m.id, purpose: "D", position: 0 });
    await prisma.assignment.update({ where: { id: d.id }, data: { progress: "DONE" } });
    const b = await assignment({ studentId: st.id, mentorId: m.id, purpose: "B", position: 2 });
    const a = await assignment({ studentId: st.id, mentorId: m.id, purpose: "A", position: 1 });
    const work = await studentWorkFor(await asReader(m.id), st.id, NOW);
    expect(work?.tasks.map((t) => t.id)).toEqual([soon.id, late.id, done.id]);
    expect(work?.plan.map((i) => i.id)).toEqual([a.id, b.id, d.id]);
  });

  it("an admin sees only their programs' rows, and no trace of the other program", async () => {
    const { p, st, m } = await world();
    const other = await program("Master's Program");
    await enroll({ studentId: st.id, programId: other.id });
    const mine = await studentTask({ studentId: st.id, mentorId: m.id, programId: p.id, title: "Mine" });
    await studentTask({ studentId: st.id, mentorId: m.id, programId: other.id, title: "Theirs" });
    await assignment({ studentId: st.id, programId: other.id, purpose: "Elsewhere" });
    const a = await admin("Dilnoza");
    await grant({ userId: a.id, programId: p.id });
    const work = await studentWorkFor(await asReader(a.id), st.id, NOW);
    expect(work?.tasks.map((t) => t.id)).toEqual([mine.id]);
    expect(work?.plan).toEqual([]);
    expect(work?.canSetTaskIn.map((x) => x.id)).toEqual([p.id]);
    expect(JSON.stringify(work)).not.toContain("Master's Program");
  });

  it("canSetTaskIn lists only programs where the reader may set a task", async () => {
    const { p, st, m } = await world();
    const second = await program("Master's Program");
    const third = await program("Exchange");
    await enroll({ studentId: st.id, programId: second.id });
    await enroll({ studentId: st.id, programId: third.id });
    const ids = async (userId: string) => (await studentWorkFor(await asReader(userId), st.id, NOW))?.canSetTaskIn.map((x) => x.id) ?? null;

    // A mentor works in one program of the three.
    expect(await ids(m.id)).toEqual([p.id]);
    // An admin sets in the programs they run, and a read-only grant sets in none.
    const a = await admin("Dilnoza");
    await grant({ userId: a.id, programId: second.id });
    expect(await ids(a.id)).toEqual([second.id]);
    const leader = await admin("Leader");
    await grant({ userId: leader.id, programId: p.id, role: "LEADER" });
    expect(await ids(leader.id)).toEqual([]);
    // A mentor in no program of the student's, who reaches them through a plan item, sets in none.
    const visitor = await mentor("Visitor");
    await assignment({ studentId: st.id, mentorId: visitor.id, programId: p.id });
    expect(await ids(visitor.id)).toEqual([]);
    // A platform admin runs them all.
    const root = await platformAdmin("Root");
    expect((await ids(root.id))?.sort()).toEqual([p.id, second.id, third.id].sort());
    // A mentor who is no longer active sets none (assertTaskAssigner's own rule).
    await prisma.user.update({ where: { id: m.id }, data: { status: "SUSPENDED" } });
    expect(await ids(m.id)).toEqual([]);
  });

  it("counts minutes logged against a plan item in one pass, every mentor's, active only", async () => {
    const { p, st, m } = await world();
    const a = await assignment({ studentId: st.id, mentorId: m.id });
    for (const status of ["ACTIVE", "ACTIVE", "VOIDED"]) {
      const s = await session({ studentId: st.id, programId: p.id, mentorId: m.id, minutes: 30, status });
      await prisma.session.update({ where: { id: s.id }, data: { assignmentId: a.id } });
    }
    expect((await studentWorkFor(await asReader(m.id), st.id, NOW))?.plan[0].loggedMinutes).toBe(60);
  });
});
