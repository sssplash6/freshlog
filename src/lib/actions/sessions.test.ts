import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  allocation,
  assignment,
  cohort,
  mentor,
  pairing,
  program,
  student,
} from "@/test/db";

/**
 * What authorizes a mentor to log time for a student.
 *
 * Four things do. The plainest is the program: a mentor assigned to a program
 * may log hours with anybody enrolled in it, holding nothing and having been
 * granted nothing, because the meeting that a colleague's absence produced
 * happens before any admin hears about it. The other three outlive the
 * pairing — a grant, a session already logged, and a task, which can be MOVED
 * onto a mentor who holds no hours there and was never in that program.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { logSession } = await import("@/lib/actions/sessions");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const log = (studentProfileId: string, extra: Record<string, string> = {}) =>
  logSession(
    null,
    form({ studentProfileId, minutes: "30", date: "2026-09-03", ...extra })
  );

describe("logSession authorization", () => {
  it("accepts a mentor whose task it is, with no hours and no program pairing", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor("Umid");
    const task = await assignment({ studentId: s.id, mentorId: m.id });
    actor.value = m;

    const state = await log(s.id, { assignmentId: task.id });

    expect(state).toMatchObject({ ok: true });
    await expect(
      prisma.session.count({ where: { mentorId: m.id, studentId: s.id } })
    ).resolves.toBe(1);
  });

  it("accepts any mentor assigned to the program, holding nothing at all", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: p.id });
    actor.value = m;

    const state = await log(s.id);

    expect(state).toMatchObject({ ok: true });
    await expect(
      prisma.session.count({ where: { mentorId: m.id, studentId: s.id, programId: p.id } })
    ).resolves.toBe(1);
  });

  it("accepts a cohort-scoped mentor for a student in another cohort", async () => {
    const p = await program("Global Admissions");
    const [autumn, spring] = await Promise.all([
      cohort({ programId: p.id, name: "Autumn" }),
      cohort({ programId: p.id, name: "Spring" }),
    ]);
    const s = await student({ programId: p.id, cohortId: spring.id });
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: p.id, cohortId: autumn.id });
    actor.value = m;

    expect(await log(s.id)).toMatchObject({ ok: true });
  });

  it("charges the program the meeting was in, not the other one the student is in", async () => {
    const [mine, theirs] = await Promise.all([program("Mine"), program("Theirs")]);
    const s = await student({ programId: mine.id });
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: mine.id });
    // Enrolled in a program this mentor does not work in: it must not be
    // offered as the program the hours come out of.
    await prisma.studentEnrollment.create({
      data: { studentId: s.id, programId: theirs.id },
    });
    actor.value = m;

    expect(await log(s.id)).toMatchObject({ ok: true });
    await expect(
      prisma.session.findFirst({ where: { mentorId: m.id }, select: { programId: true } })
    ).resolves.toEqual({ programId: mine.id });
  });

  it("still refuses a mentor with no hours, no pairing and no task there", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor();
    actor.value = m;

    const state = await log(s.id);

    expect(state).toMatchObject({ ok: false, field: "studentProfileId" });
    await expect(prisma.session.count()).resolves.toBe(0);
  });

  it("accepts a mentor who holds hours there, task or no task", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor();
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 600 });
    actor.value = m;

    const state = await log(s.id);

    expect(state).toMatchObject({ ok: true });
  });
});
