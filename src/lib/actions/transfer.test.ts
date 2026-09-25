import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  admin,
  allocation,
  assignment,
  grant,
  mentor,
  program,
  session,
  student,
} from "@/test/db";

/**
 * A student changes mentors partway through: their unused time moves, what was
 * already delivered stays, and the total they hold does not change. Before this
 * the move was a grant to the new mentor and a cut to the old one that nobody
 * remembered, so the student showed up holding both.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { transferMentorAllocation } = await import("@/lib/actions/students");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

async function setup() {
  const prog = await program("Global Admissions");
  const boss = await admin("Boss");
  await grant({ userId: boss.id, programId: prog.id });
  const doston = await mentor("Doston");
  const malina = await mentor("Malina");
  const guzal = await student({ programId: prog.id });
  actor.value = boss;
  return { prog, boss, doston, malina, guzal };
}

const held = async (studentId: string, mentorId: string) =>
  (await prisma.hourAllocation.findFirst({ where: { studentId, mentorId } }))?.minutes;

describe("moving time between mentors", () => {
  it("moves the unused minutes and keeps the total", async () => {
    const { prog, doston, malina, guzal } = await setup();
    await allocation({ studentId: guzal.id, mentorId: doston.id, minutes: 720 });
    await session({ studentId: guzal.id, mentorId: doston.id, minutes: 120 });

    const state = await transferMentorAllocation(
      null,
      form({
        studentProfileId: guzal.id,
        programId: prog.id,
        fromMentorId: doston.id,
        toMentorId: malina.id,
        minutes: "600",
      })
    );

    expect(state).toMatchObject({ ok: true });
    await expect(held(guzal.id, doston.id)).resolves.toBe(120);
    await expect(held(guzal.id, malina.id)).resolves.toBe(600);
    // Malina is brought into the program, and both halves are audited.
    await expect(
      prisma.mentorAssignment.count({ where: { mentorId: malina.id, programId: prog.id } })
    ).resolves.toBe(1);
    await expect(prisma.hourAllotmentChange.count()).resolves.toBe(2);
  });

  it("tops up time the new mentor already holds", async () => {
    const { prog, doston, malina, guzal } = await setup();
    await allocation({ studentId: guzal.id, mentorId: doston.id, minutes: 720 });
    await allocation({ studentId: guzal.id, mentorId: malina.id, minutes: 60 });

    await transferMentorAllocation(
      null,
      form({
        studentProfileId: guzal.id,
        programId: prog.id,
        fromMentorId: doston.id,
        toMentorId: malina.id,
        minutes: "720",
      })
    );

    await expect(held(guzal.id, doston.id)).resolves.toBe(0);
    await expect(held(guzal.id, malina.id)).resolves.toBe(780);
  });

  it("refuses to move time that was already delivered", async () => {
    const { prog, doston, malina, guzal } = await setup();
    await allocation({ studentId: guzal.id, mentorId: doston.id, minutes: 720 });
    await session({ studentId: guzal.id, mentorId: doston.id, minutes: 120 });

    const state = await transferMentorAllocation(
      null,
      form({
        studentProfileId: guzal.id,
        programId: prog.id,
        fromMentorId: doston.id,
        toMentorId: malina.id,
        minutes: "720",
      })
    );

    expect(state).toMatchObject({ ok: false });
    await expect(held(guzal.id, doston.id)).resolves.toBe(720);
    await expect(held(guzal.id, malina.id)).resolves.toBeUndefined();
  });

  it("refuses forfeited time", async () => {
    const { prog, doston, malina, guzal } = await setup();
    await allocation({
      studentId: guzal.id,
      mentorId: doston.id,
      minutes: 720,
      deadlineInDays: -3,
    });

    const state = await transferMentorAllocation(
      null,
      form({
        studentProfileId: guzal.id,
        programId: prog.id,
        fromMentorId: doston.id,
        toMentorId: malina.id,
        minutes: "60",
      })
    );

    expect(state).toMatchObject({ ok: false });
  });

  it("hands open tasks over when asked, and leaves finished ones", async () => {
    const { prog, doston, malina, guzal } = await setup();
    await allocation({ studentId: guzal.id, mentorId: doston.id, minutes: 720 });
    const open = await assignment({ studentId: guzal.id, mentorId: doston.id });
    const done = await assignment({ studentId: guzal.id, mentorId: doston.id });
    await prisma.assignment.update({ where: { id: done.id }, data: { progress: "DONE" } });

    await transferMentorAllocation(
      null,
      form({
        studentProfileId: guzal.id,
        programId: prog.id,
        fromMentorId: doston.id,
        toMentorId: malina.id,
        minutes: "720",
        moveTasks: "on",
      })
    );

    const after = await prisma.assignment.findMany({ select: { id: true, mentorId: true } });
    expect(after.find((a) => a.id === open.id)?.mentorId).toBe(malina.id);
    expect(after.find((a) => a.id === done.id)?.mentorId).toBe(doston.id);
  });

  it("is refused to an admin of another program", async () => {
    const { prog, doston, malina, guzal } = await setup();
    await allocation({ studentId: guzal.id, mentorId: doston.id, minutes: 720 });
    const other = await program("Imkon");
    const stranger = await admin("Stranger");
    await grant({ userId: stranger.id, programId: other.id });
    actor.value = stranger;

    const state = await transferMentorAllocation(
      null,
      form({
        studentProfileId: guzal.id,
        programId: prog.id,
        fromMentorId: doston.id,
        toMentorId: malina.id,
        minutes: "60",
      })
    );

    expect(state).toMatchObject({ ok: false });
    await expect(held(guzal.id, doston.id)).resolves.toBe(720);
  });

  it("will not move time to the admin doing it", async () => {
    const { prog, boss, doston, guzal } = await setup();
    await prisma.user.update({ where: { id: boss.id }, data: { isMentor: true } });
    await allocation({ studentId: guzal.id, mentorId: doston.id, minutes: 720 });

    const state = await transferMentorAllocation(
      null,
      form({
        studentProfileId: guzal.id,
        programId: prog.id,
        fromMentorId: doston.id,
        toMentorId: boss.id,
        minutes: "60",
      })
    );

    expect(state).toMatchObject({ ok: false });
  });
});
