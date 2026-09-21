import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, grant, mentor, pairing, program, student, studentTask } from "@/test/db";

/**
 * Who may move a task's progress.
 *
 * It was the student alone, and that was the stated reason a task is a second
 * table beside the agenda. Since 21 September 2026 the mentor who set it may
 * move it too — they are the person who reads the draft — and so may an admin
 * of the program it was set in. Nobody else, whatever else they can see about
 * the student.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { setStudentTaskProgress } = await import("@/lib/actions/student-tasks");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const move = (taskId: string, extra: Record<string, string> = {}) =>
  setStudentTaskProgress(null, form({ taskId, ...extra }));

async function scene() {
  const p = await program("Master's");
  const s = await student({ programId: p.id, name: "Khabiba" });
  const m = await mentor("Umid");
  await pairing({ mentorId: m.id, programId: p.id });
  const task = await studentTask({ studentId: s.id, mentorId: m.id });
  return { p, s, m, task, studentUserId: s.userId };
}

describe("setStudentTaskProgress", () => {
  it("lets the mentor who set it say how far along it is", async () => {
    const { m, task } = await scene();
    actor.value = m;

    const state = await move(task.id, { percent: "50" });

    expect(state).toMatchObject({ ok: true });
    const after = await prisma.studentTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.percent).toBe(50);
  });

  it("tells the student, by name, that their mentor moved it", async () => {
    const { m, task, studentUserId } = await scene();
    actor.value = m;

    await move(task.id, { percent: "50" });

    const notice = await prisma.notification.findFirst({
      where: { userId: studentUserId },
    });
    expect(notice?.message).toBe('Umid marked "Rewrite the draft" 50% done.');
  });

  it("lets the mentor mark it done, and does not notify themselves", async () => {
    const { m, task, studentUserId } = await scene();
    actor.value = m;

    const state = await move(task.id, { intent: "done" });

    expect(state).toMatchObject({ ok: true });
    const after = await prisma.studentTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.completedAt).not.toBeNull();
    await expect(
      prisma.notification.count({ where: { userId: m.id } })
    ).resolves.toBe(0);
    await expect(
      prisma.notification.count({ where: { userId: studentUserId } })
    ).resolves.toBe(1);
  });

  it("lets an admin of the task's own program move it", async () => {
    const { p, task } = await scene();
    const a = await admin("Malika");
    await grant({ userId: a.id, programId: p.id });
    actor.value = a;

    const state = await move(task.id, { percent: "75" });

    expect(state).toMatchObject({ ok: true });
    const after = await prisma.studentTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.percent).toBe(75);
  });

  it("refuses a mentor in the same program who did not set it", async () => {
    const { p, task } = await scene();
    const other = await mentor("Nigel");
    await pairing({ mentorId: other.id, programId: p.id });
    actor.value = other;

    const state = await move(task.id, { percent: "50" });

    expect(state).toMatchObject({ ok: false });
    const after = await prisma.studentTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.percent).toBe(0);
  });

  it("refuses an admin of another program", async () => {
    const { task } = await scene();
    const elsewhere = await program("Global Admissions");
    const a = await admin();
    await grant({ userId: a.id, programId: elsewhere.id });
    actor.value = a;

    const state = await move(task.id, { percent: "50" });

    expect(state).toMatchObject({ ok: false });
  });

  /** The write this always was, and still is. */
  it("still lets the student move their own, telling the mentor", async () => {
    const { m, task, studentUserId } = await scene();
    actor.value = { id: studentUserId };

    const state = await move(task.id, { intent: "done" });

    expect(state).toMatchObject({ ok: true });
    const notice = await prisma.notification.findFirst({ where: { userId: m.id } });
    expect(notice?.message).toBe('Khabiba finished "Rewrite the draft".');
  });

  it("stays quiet when the student only nudges the percentage", async () => {
    const { task, studentUserId } = await scene();
    actor.value = { id: studentUserId };

    await move(task.id, { percent: "25" });

    await expect(prisma.notification.count()).resolves.toBe(0);
  });
});
