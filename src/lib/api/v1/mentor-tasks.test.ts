import { describe, expect, it } from "vitest";

import { mentorShareFor, mentorTasksFor } from "@/lib/api/v1/mentor-tasks";
import { prisma } from "@/lib/prisma";
import { admin, DAY, grant, mentor, NOW, program, student } from "@/test/db";
import { programToday } from "@/lib/when";

/**
 * A mentor's own shares of the tasks their program's admin set them. The list
 * is the website's `mentorOwnTasks`, sorted here the way its comment says it
 * is: open first, then what was finished in the last fortnight.
 */
const day = (n: number) => new Date(Date.parse(`${programToday(NOW)}T00:00:00.000Z`) + n * DAY);

async function scene() {
  const p = await program("Global Admissions");
  const a = await admin("Malika Yusupova");
  await grant({ userId: a.id, programId: p.id });
  const m = await mentor("Akmal Karimov");
  return { p, a, m };
}

/** One task set by the admin to `m`, with its share. */
async function setFor(
  w: Awaited<ReturnType<typeof scene>>,
  opts: { title: string; dueIn: number; doneAgo?: number; studentIds?: string[]; note?: string | null }
) {
  const task = await prisma.mentorTask.create({
    data: {
      programId: w.p.id,
      title: opts.title,
      note: opts.note ?? null,
      dueOn: day(opts.dueIn),
      createdById: w.a.id,
      students: { create: (opts.studentIds ?? []).map((studentId) => ({ studentId })) },
      assignees: {
        create: {
          mentorId: w.m.id,
          completedAt: opts.doneAgo === undefined ? null : new Date(NOW.getTime() - opts.doneAgo * DAY),
        },
      },
    },
    include: { assignees: true },
  });
  return { task, share: task.assignees[0] };
}

describe("mentorTasksFor", () => {
  it("open tasks come before done ones whatever their due days", async () => {
    const w = await scene();
    await setFor(w, { title: "Done early", dueIn: -9, doneAgo: 1 });
    await setFor(w, { title: "Open late", dueIn: 20 });
    await setFor(w, { title: "Open soon", dueIn: 2 });
    await setFor(w, { title: "Done long ago", dueIn: 1, doneAgo: 10 });
    const list = await mentorTasksFor(w.m, NOW);
    expect(list?.items.map((t) => t.title)).toEqual(["Open soon", "Open late", "Done early", "Done long ago"]);
    expect(list?.items.map((t) => t.done)).toEqual([false, false, true, true]);
  });

  it("a share done 15 days ago is not listed; one done 13 days ago is", async () => {
    const w = await scene();
    await setFor(w, { title: "Stale", dueIn: -20, doneAgo: 15 });
    await setFor(w, { title: "Recent", dueIn: -20, doneAgo: 13 });
    const list = await mentorTasksFor(w.m, NOW);
    expect(list?.items.map((t) => t.title)).toEqual(["Recent"]);
  });

  it("says who set it, for whom, and the days left and overdue rule of the website", async () => {
    const w = await scene();
    const st = await student({ programId: w.p.id, name: "Aziza Karimova" });
    await setFor(w, { title: "Today", dueIn: 0 });
    await setFor(w, { title: "Yesterday", dueIn: -1, studentIds: [st.id], note: "Read them" });
    await setFor(w, { title: "Late but done", dueIn: -3, doneAgo: 1 });
    const list = await mentorTasksFor(w.m, NOW);
    expect(list?.today).toBe(programToday(NOW));
    const by = Object.fromEntries((list?.items ?? []).map((t) => [t.title, t]));
    expect(by.Today).toMatchObject({ daysLeft: 0, overdue: false, done: false, completedAt: null, due: programToday(NOW) });
    expect(by.Yesterday).toMatchObject({
      daysLeft: -1,
      overdue: true,
      note: "Read them",
      from: { id: w.a.id, name: "Malika Yusupova" },
      program: { id: w.p.id, name: "Global Admissions" },
      about: [{ id: st.id, userId: st.userId, name: "Aziza Karimova" }],
    });
    expect(by["Late but done"]).toMatchObject({ daysLeft: -3, overdue: false, done: true });
    expect(by["Late but done"].completedAt).toEqual(expect.any(String));
  });

  it("is null for someone who cannot act as a mentor", async () => {
    const w = await scene();
    expect(await mentorTasksFor(w.a, NOW)).toBeNull();
  });

  it("lists only the reader's own shares", async () => {
    const w = await scene();
    const other = await mentor("Umid Rashidov");
    await setFor(w, { title: "Mine", dueIn: 1 });
    const { task } = await setFor(w, { title: "Also theirs", dueIn: 1 });
    await prisma.mentorTaskAssignee.create({ data: { taskId: task.id, mentorId: other.id } });
    const list = await mentorTasksFor(other, NOW);
    expect(list?.items.map((t) => t.title)).toEqual(["Also theirs"]);
  });
});

describe("mentorShareFor", () => {
  it("reads the reader's own share, and nobody else's", async () => {
    const w = await scene();
    const other = await mentor("Umid Rashidov");
    const { share } = await setFor(w, { title: "Mine", dueIn: 1 });
    expect(await mentorShareFor(w.m, share.id)).toEqual({ id: share.id });
    expect(await mentorShareFor(other, share.id)).toBeNull();
    expect(await mentorShareFor(w.m, "c-made-up")).toBeNull();
  });
});
