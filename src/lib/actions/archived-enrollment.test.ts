import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { PROGRAM_STATUS, ROLES, USER_STATUS } from "@/lib/constants";
import { admin, cohort, grant, program, student } from "@/test/db";

/**
 * An archived program is one nothing new should be enrolled into. The pickers
 * leave it out; these pin that every action that puts somebody into a program
 * refuses one too, since a page or a hand-made request can still name it.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
// The welcome email is queued with `after()`, which needs a request.
vi.mock("@/lib/email/welcome", async (original) => ({
  ...(await original<typeof import("@/lib/email/welcome")>()),
  sendWelcomeEmails: () => {},
}));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { completeOnboarding, createStudents, enrollStudent, moveStudent } = await import(
  "@/lib/actions/students"
);

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

async function archived(name = "Old Program") {
  const p = await program(name);
  return prisma.program.update({
    where: { id: p.id },
    data: { status: PROGRAM_STATUS.ARCHIVED },
  });
}

/** An admin of every program named. */
async function adminOf(...programIds: string[]) {
  const boss = await admin("Boss");
  for (const programId of programIds) await grant({ userId: boss.id, programId });
  actor.value = boss;
  return boss;
}

const REFUSAL = "Old Program is archived, so it can't take students.";

describe("an archived program takes no new students", () => {
  it("refuses Add students, and creates nobody", async () => {
    const old = await archived();
    await adminOf(old.id);

    const res = await createStudents(
      null,
      form({ programId: old.id, email: "new@test.invalid", firstName: "New", lastName: "Student" })
    );

    expect(res).toEqual({ ok: false, error: REFUSAL });
    expect(await prisma.user.count({ where: { email: "new@test.invalid" } })).toBe(0);
    expect(await prisma.studentEnrollment.count({ where: { programId: old.id } })).toBe(0);
  });

  it("refuses enrolling a student who is in another program", async () => {
    const old = await archived();
    const s = await student({ programId: (await program("Elsewhere")).id });
    await adminOf(old.id);

    const res = await enrollStudent(null, form({ studentProfileId: s.id, programId: old.id }));

    expect(res).toEqual({ ok: false, error: REFUSAL });
    expect(await prisma.studentEnrollment.count({ where: { programId: old.id } })).toBe(0);
  });

  it("refuses moving a student into it", async () => {
    const old = await archived();
    const here = await program("Here");
    const s = await student({ programId: here.id });
    await adminOf(old.id, here.id);

    const res = await moveStudent(null, form({ studentProfileId: s.id, programId: old.id }));

    expect(res).toEqual({ ok: false, error: REFUSAL });
    const [only] = await prisma.studentEnrollment.findMany({ where: { studentId: s.id } });
    expect(only.programId).toBe(here.id);
  });

  it("still lets a student already in it change cohort", async () => {
    const old = await archived();
    const [spring, fall] = await Promise.all([
      cohort({ programId: old.id, name: "Spring" }),
      cohort({ programId: old.id, name: "Fall" }),
    ]);
    const s = await student({ programId: old.id, cohortId: spring.id });
    await adminOf(old.id);

    const res = await moveStudent(
      null,
      form({ studentProfileId: s.id, programId: old.id, cohortId: fall.id })
    );

    expect(res?.ok).toBe(true);
    const [only] = await prisma.studentEnrollment.findMany({ where: { studentId: s.id } });
    expect(only.cohortId).toBe(fall.id);
  });

  it("refuses a self sign-up for it", async () => {
    const old = await archived();
    const me = await prisma.user.create({
      data: {
        email: "signup@test.invalid",
        role: ROLES.STUDENT,
        status: USER_STATUS.PENDING,
      },
    });
    actor.value = me;

    const res = await completeOnboarding(
      null,
      form({ programId: old.id, name: "Sign Up", telegramUsername: "sign_up_tg" })
    );

    expect(res).toEqual({ ok: false, error: REFUSAL });
    expect(await prisma.studentProfile.count({ where: { userId: me.id } })).toBe(0);
  });
});
