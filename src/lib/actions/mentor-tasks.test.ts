import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, grant, mentor, pairing, program, student } from "@/test/db";

/**
 * Tasks a program's admin sets its mentors: who may set one, who it may name,
 * and who may tick it off.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { setMentorTask, setMentorTaskDone, deleteMentorTask } = await import(
  "@/lib/actions/mentor-tasks"
);

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const one of Array.isArray(v) ? v : [v]) data.append(k, one);
  }
  return data;
}

async function scene() {
  const p = await program("Global Admissions");
  const a = await admin("Malika");
  await grant({ userId: a.id, programId: p.id });
  const m1 = await mentor("Umid");
  const m2 = await mentor("Nigora");
  await pairing({ mentorId: m1.id, programId: p.id });
  await pairing({ mentorId: m2.id, programId: p.id });
  const s1 = await student({ programId: p.id, name: "Aziza" });
  const s2 = await student({ programId: p.id, name: "Bekzod" });
  return { p, a, m1, m2, s1, s2 };
}

const set = (fields: Record<string, string | string[]>) =>
  setMentorTask(null, form({ title: "Read the essays", dueOn: "2030-01-15", ...fields }));

describe("setMentorTask", () => {
  it("sets one task to the whole team, about several students, and tells each mentor", async () => {
    const { p, a, m1, m2, s1, s2 } = await scene();
    actor.value = a;

    const state = await set({
      programId: p.id,
      mentorIds: [m1.id, m2.id],
      studentIds: [s1.id, s2.id],
    });

    expect(state).toMatchObject({ ok: true, message: '"Read the essays" set for the whole team.' });
    const task = await prisma.mentorTask.findFirstOrThrow({
      include: { assignees: true, students: true },
    });
    expect(task.assignees.map((x) => x.mentorId).sort()).toEqual([m1.id, m2.id].sort());
    expect(task.students.map((x) => x.studentId).sort()).toEqual([s1.id, s2.id].sort());
    await expect(
      prisma.notification.count({ where: { type: "MENTOR_TASK_SET" } })
    ).resolves.toBe(2);
  });

  it("sets a task to one mentor with no student attached", async () => {
    const { p, a, m1 } = await scene();
    actor.value = a;

    const state = await set({ programId: p.id, mentorIds: [m1.id] });

    expect(state).toMatchObject({ ok: true });
    const task = await prisma.mentorTask.findFirstOrThrow({ include: { students: true } });
    expect(task.students).toHaveLength(0);
  });

  it("refuses with no mentor picked", async () => {
    const { p, a } = await scene();
    actor.value = a;

    const state = await set({ programId: p.id });

    expect(state).toMatchObject({ ok: false, error: "Pick at least one mentor." });
  });

  it("refuses a mentor who is not paired to the program", async () => {
    const { p, a, m1 } = await scene();
    const outsider = await mentor("Outside");
    actor.value = a;

    const state = await set({ programId: p.id, mentorIds: [m1.id, outsider.id] });

    expect(state).toMatchObject({ ok: false });
    await expect(prisma.mentorTask.count()).resolves.toBe(0);
  });

  it("refuses a student from another program", async () => {
    const { p, a, m1 } = await scene();
    const other = await program("Master's");
    const elsewhere = await student({ programId: other.id, name: "Elsewhere" });
    actor.value = a;

    const state = await set({ programId: p.id, mentorIds: [m1.id], studentIds: [elsewhere.id] });

    expect(state).toMatchObject({ ok: false });
    await expect(prisma.mentorTask.count()).resolves.toBe(0);
  });

  it("refuses a read-only LEADER grant and an admin of another program", async () => {
    const { p, m1 } = await scene();
    const leader = await admin("Leader");
    await grant({ userId: leader.id, programId: p.id, role: "LEADER" });
    const stranger = await admin("Stranger");
    await grant({ userId: stranger.id, programId: (await program("Other")).id });

    for (const who of [leader, stranger, m1]) {
      actor.value = who;
      const state = await set({ programId: p.id, mentorIds: [m1.id] });
      expect(state).toMatchObject({ ok: false });
    }
    await expect(prisma.mentorTask.count()).resolves.toBe(0);
  });
});

describe("setMentorTaskDone", () => {
  async function withTask() {
    const ctx = await scene();
    actor.value = ctx.a;
    await set({ programId: ctx.p.id, mentorIds: [ctx.m1.id, ctx.m2.id] });
    const shares = await prisma.mentorTaskAssignee.findMany();
    const share = (id: string) => shares.find((s) => s.mentorId === id)!;
    return { ...ctx, share };
  }

  it("lets a mentor finish their own share, tells the admin, and leaves the other share open", async () => {
    const { a, m1, m2, share } = await withTask();
    actor.value = m1;

    const state = await setMentorTaskDone(
      null,
      form({ assigneeId: share(m1.id).id, intent: "done" })
    );

    expect(state).toMatchObject({ ok: true });
    const after = await prisma.mentorTaskAssignee.findMany();
    expect(after.find((s) => s.mentorId === m1.id)?.completedAt).not.toBeNull();
    expect(after.find((s) => s.mentorId === m2.id)?.completedAt).toBeNull();
    await expect(
      prisma.notification.count({ where: { userId: a.id, type: "MENTOR_TASK_DONE" } })
    ).resolves.toBe(1);
  });

  it("lets them take the tick back", async () => {
    const { m1, share } = await withTask();
    actor.value = m1;
    const id = share(m1.id).id;

    await setMentorTaskDone(null, form({ assigneeId: id, intent: "done" }));
    await setMentorTaskDone(null, form({ assigneeId: id, intent: "reopen" }));

    const after = await prisma.mentorTaskAssignee.findUniqueOrThrow({ where: { id } });
    expect(after.completedAt).toBeNull();
  });

  it("refuses a mentor ticking somebody else's share", async () => {
    const { m1, m2, share } = await withTask();
    actor.value = m2;

    const state = await setMentorTaskDone(
      null,
      form({ assigneeId: share(m1.id).id, intent: "done" })
    );

    expect(state).toMatchObject({ ok: false, error: "That task no longer exists." });
  });
});

describe("deleteMentorTask", () => {
  it("lets the program's admin withdraw it, and nobody else", async () => {
    const { p, a, m1 } = await scene();
    actor.value = a;
    await set({ programId: p.id, mentorIds: [m1.id] });
    const task = await prisma.mentorTask.findFirstOrThrow();

    actor.value = m1;
    expect(await deleteMentorTask(null, form({ taskId: task.id }))).toMatchObject({ ok: false });

    actor.value = a;
    expect(await deleteMentorTask(null, form({ taskId: task.id }))).toMatchObject({ ok: true });
    await expect(prisma.mentorTaskAssignee.count()).resolves.toBe(0);
  });
});
