import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { ASSIGNMENT_PROGRESS, EXCHANGE_STATUS } from "@/lib/constants";
import {
  allocation,
  assignment,
  cohort,
  inDays,
  mentor,
  platformAdmin,
  program,
  session,
  student,
  studentTask,
} from "@/test/db";

/**
 * Moving a student to another program carries their unused time with them.
 *
 * Until 30 September 2026 a move re-pointed the enrollment and nothing else:
 * every hour and every mentor stayed keyed to the old program, the student page
 * scoped them out, and an admin who moved Milana Kim to Advanced Research read
 * "all her hours are gone". They were not gone — moving her back showed them
 * again — but a move that hides a student's time is a move nobody can use.
 *
 * What carries is what `transferMentorAllocation` moves between mentors: the
 * unused, unexpired minutes. What was delivered stays with the program that
 * delivered it, as its record.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { moveStudent } = await import("@/lib/actions/students");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

async function setup() {
  const research = await program("Research");
  const advanced = await program("Advanced Research");
  const aziza = await mentor("Aziza");
  const bobur = await mentor("Bobur");
  const milana = await student({ programId: research.id, name: "Milana Kim" });
  actor.value = await platformAdmin();
  return { research, advanced, aziza, bobur, milana };
}

const move = (studentProfileId: string, programId: string) =>
  moveStudent(null, form({ studentProfileId, programId }));

const held = (studentId: string, programId: string, mentorId: string | null) =>
  prisma.hourAllocation.findFirst({ where: { studentId, programId, mentorId } });

describe("moving a student carries their unused time", () => {
  it("re-grants each mentor's unused minutes in the new program, and leaves what was delivered", async () => {
    const { research, advanced, aziza, bobur, milana } = await setup();
    await allocation({ studentId: milana.id, mentorId: aziza.id, minutes: 600 });
    await allocation({ studentId: milana.id, mentorId: bobur.id, minutes: 360 });
    await session({ studentId: milana.id, mentorId: aziza.id, minutes: 240 });

    const state = await move(milana.id, advanced.id);

    expect(state).toMatchObject({ ok: true });
    await expect(held(milana.id, research.id, aziza.id)).resolves.toMatchObject({ minutes: 240 });
    await expect(held(milana.id, research.id, bobur.id)).resolves.toMatchObject({ minutes: 0 });
    await expect(held(milana.id, advanced.id, aziza.id)).resolves.toMatchObject({ minutes: 360 });
    await expect(held(milana.id, advanced.id, bobur.id)).resolves.toMatchObject({ minutes: 360 });
    // Both mentors can work with her in the new program, and both halves of
    // each carry are audited.
    await expect(
      prisma.mentorAssignment.count({ where: { programId: advanced.id } })
    ).resolves.toBe(2);
    await expect(
      prisma.hourAllotmentChange.count({ where: { studentId: milana.id } })
    ).resolves.toBe(4);
  });

  it("keeps the deadline the time was granted with", async () => {
    const { advanced, aziza, milana } = await setup();
    const source = await allocation({
      studentId: milana.id,
      mentorId: aziza.id,
      minutes: 600,
      deadlineInDays: 45,
    });

    await move(milana.id, advanced.id);

    await expect(held(milana.id, advanced.id, aziza.id)).resolves.toMatchObject({
      deadline: source.deadline,
    });
  });

  it("does not carry forfeited time", async () => {
    const { research, advanced, aziza, milana } = await setup();
    await allocation({
      studentId: milana.id,
      mentorId: aziza.id,
      minutes: 600,
      deadlineInDays: -1,
    });

    await move(milana.id, advanced.id);

    await expect(held(milana.id, research.id, aziza.id)).resolves.toMatchObject({ minutes: 600 });
    await expect(held(milana.id, advanced.id, aziza.id)).resolves.toBeNull();
  });

  it("tops up time already held in the new program, keeping the later deadline", async () => {
    const { advanced, milana, research } = await setup();
    await allocation({
      studentId: milana.id,
      programId: research.id,
      mentorId: null,
      minutes: 300,
      deadlineInDays: 60,
    });
    // Left over from an earlier stay: the standard grant a first move gave her.
    const leftover = await allocation({
      studentId: milana.id,
      programId: advanced.id,
      mentorId: null,
      minutes: 600,
      deadlineInDays: 90,
    });

    await move(milana.id, advanced.id);

    const pools = await prisma.hourAllocation.findMany({
      where: { studentId: milana.id, programId: advanced.id, mentorId: null },
    });
    expect(pools).toHaveLength(1);
    expect(pools[0]).toMatchObject({ minutes: 900, deadline: leftover.deadline });
  });

  it("gives back exactly what she held after a move there and back", async () => {
    const { research, advanced, aziza, milana } = await setup();
    await allocation({ studentId: milana.id, mentorId: aziza.id, minutes: 600 });
    await session({ studentId: milana.id, mentorId: aziza.id, minutes: 120 });

    await move(milana.id, advanced.id);
    await move(milana.id, research.id);

    const all = await prisma.hourAllocation.findMany({ where: { studentId: milana.id } });
    expect(all.reduce((sum, a) => sum + a.minutes, 0)).toBe(600);
    await expect(held(milana.id, research.id, aziza.id)).resolves.toMatchObject({ minutes: 600 });
    await expect(held(milana.id, advanced.id, aziza.id)).resolves.toMatchObject({ minutes: 0 });
  });

  it("pours everything into the bank of a program that runs one", async () => {
    const { advanced, aziza, bobur, milana } = await setup();
    await prisma.program.update({ where: { id: advanced.id }, data: { hourBank: true } });
    await allocation({ studentId: milana.id, mentorId: aziza.id, minutes: 600 });
    await allocation({ studentId: milana.id, mentorId: bobur.id, minutes: 300 });
    await session({ studentId: milana.id, mentorId: aziza.id, minutes: 100 });

    await move(milana.id, advanced.id);

    const rows = await prisma.hourAllocation.findMany({
      where: { studentId: milana.id, programId: advanced.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isBank: true, mentorId: null, minutes: 800 });
    // The mentors are still hers to meet, from the bank.
    await expect(
      prisma.mentorAssignment.count({ where: { programId: advanced.id } })
    ).resolves.toBe(2);
  });

  it("carries an old bank's unspent minutes into the unassigned time", async () => {
    const { research, advanced, aziza, milana } = await setup();
    await prisma.program.update({ where: { id: research.id }, data: { hourBank: true } });
    const bank = await allocation({ studentId: milana.id, mentorId: null, minutes: 600 });
    await prisma.hourAllocation.update({ where: { id: bank.id }, data: { isBank: true } });
    const s = await session({ studentId: milana.id, mentorId: aziza.id, minutes: 200 });
    await prisma.session.update({ where: { id: s.id }, data: { fromBank: true } });

    await move(milana.id, advanced.id);

    await expect(
      prisma.hourAllocation.findUniqueOrThrow({ where: { id: bank.id } })
    ).resolves.toMatchObject({ minutes: 200 });
    await expect(held(milana.id, advanced.id, null)).resolves.toMatchObject({
      minutes: 400,
      isBank: false,
    });
  });

  it("moves the payment with the hours when both programs track it", async () => {
    const { research, advanced, aziza, milana } = await setup();
    await prisma.program.updateMany({
      where: { id: { in: [research.id, advanced.id] } },
      data: { tracksPayment: true },
    });
    await allocation({ studentId: milana.id, mentorId: aziza.id, minutes: 600, amountPaid: 300 });
    await session({ studentId: milana.id, mentorId: aziza.id, minutes: 200 });

    await move(milana.id, advanced.id);

    await expect(held(milana.id, research.id, aziza.id)).resolves.toMatchObject({
      amountPaid: 100,
    });
    await expect(held(milana.id, advanced.id, aziza.id)).resolves.toMatchObject({
      amountPaid: 200,
    });
  });

  it("takes the untouched tasks along and leaves the ones already worked on", async () => {
    const { research, advanced, aziza, milana } = await setup();
    await allocation({ studentId: milana.id, mentorId: aziza.id, minutes: 600 });
    const fresh = await assignment({ studentId: milana.id, mentorId: aziza.id, purpose: "Proposal" });
    const started = await assignment({ studentId: milana.id, mentorId: aziza.id, purpose: "Lit review" });
    await session({
      studentId: milana.id,
      mentorId: aziza.id,
      minutes: 60,
      assignmentId: started.id,
    });
    const done = await assignment({ studentId: milana.id, mentorId: aziza.id, purpose: "Topic" });
    await prisma.assignment.update({
      where: { id: done.id },
      data: { progress: ASSIGNMENT_PROGRESS.DONE },
    });
    const todo = await studentTask({ studentId: milana.id, mentorId: aziza.id, title: "Read" });
    const halfway = await studentTask({ studentId: milana.id, mentorId: aziza.id, title: "Draft" });
    await prisma.studentTask.update({ where: { id: halfway.id }, data: { percent: 50 } });

    await move(milana.id, advanced.id);

    const programOf = async (id: string) =>
      (await prisma.assignment.findUniqueOrThrow({ where: { id } })).programId;
    await expect(programOf(fresh.id)).resolves.toBe(advanced.id);
    await expect(programOf(started.id)).resolves.toBe(research.id);
    await expect(programOf(done.id)).resolves.toBe(research.id);
    const taskProgramOf = async (id: string) =>
      (await prisma.studentTask.findUniqueOrThrow({ where: { id } })).programId;
    await expect(taskProgramOf(todo.id)).resolves.toBe(advanced.id);
    await expect(taskProgramOf(halfway.id)).resolves.toBe(research.id);
  });

  it("refuses to take her out of a program that has her out on exchange", async () => {
    const { research, advanced, milana } = await setup();
    const host = await program("Global Admissions");
    const boss = await platformAdmin("Sender");
    await prisma.programExchange.create({
      data: {
        studentId: milana.id,
        fromProgramId: research.id,
        toProgramId: host.id,
        minutes: 420,
        deadline: inDays(60),
        sentById: boss.id,
      },
    });
    const own = await prisma.studentEnrollment.findFirstOrThrow({
      where: { studentId: milana.id, programId: research.id },
    });
    const { unenrollStudent } = await import("@/lib/actions/students");

    await expect(move(milana.id, advanced.id)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("Global Admissions"),
    });
    // In a second program too, so "their only program" is not what refuses it.
    await prisma.studentEnrollment.create({
      data: { studentId: milana.id, programId: (await program("Seminar")).id },
    });
    await expect(
      unenrollStudent(null, form({ enrollmentId: own.id }))
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("exchange") });
    await expect(
      prisma.studentEnrollment.findUniqueOrThrow({ where: { id: own.id } })
    ).resolves.toMatchObject({ programId: research.id });

    // Once the visit is over, she can go.
    await prisma.programExchange.updateMany({ data: { status: EXCHANGE_STATUS.RETURNED } });
    await expect(
      moveStudent(
        null,
        form({ studentProfileId: milana.id, enrollmentId: own.id, programId: advanced.id })
      )
    ).resolves.toMatchObject({ ok: true });
  });

  it("carries nothing on a move between two cohorts of one program", async () => {
    const { research, aziza } = await setup();
    const [spring, autumn] = await Promise.all([
      cohort({ programId: research.id, name: "Spring" }),
      cohort({ programId: research.id, name: "Autumn" }),
    ]);
    const s = await student({ programId: research.id, cohortId: spring.id });
    await allocation({ studentId: s.id, mentorId: aziza.id, minutes: 600 });

    await moveStudent(
      null,
      form({ studentProfileId: s.id, programId: research.id, cohortId: autumn.id })
    );

    await expect(held(s.id, research.id, aziza.id)).resolves.toMatchObject({ minutes: 600 });
    await expect(prisma.hourAllocation.count({ where: { studentId: s.id } })).resolves.toBe(1);
  });
});
