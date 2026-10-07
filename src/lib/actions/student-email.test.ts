import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  admin,
  allocation,
  grant,
  mentor,
  program,
  session,
  student,
} from "@/test/db";
import { NOTIFICATION_TYPES, ROLES, USER_STATUS } from "@/lib/constants";

/**
 * A student who can no longer reach their sign-in address — a Hotmail inbox
 * with no Google account behind it — gets pointed at the address they CAN
 * sign in with. Usually they have already tried, so that address holds the
 * stub Google sign-in made: a PENDING account with nothing in it, which the
 * change absorbs. An address held by a real account still refuses.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { setStudentEmail } = await import("@/lib/actions/students");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

async function setup() {
  const prog = await program("Global Admissions");
  const boss = await admin("Boss");
  await grant({ userId: boss.id, programId: prog.id });
  const pupil = await student({ programId: prog.id });
  actor.value = boss;
  return { prog, boss, pupil };
}

/** The account Google sign-in writes the moment an unknown email appears. */
async function stub(
  email: string,
  programId?: string,
  status: string = USER_STATUS.PENDING
) {
  const user = await prisma.user.create({
    data: {
      email,
      name: "Second Account",
      role: ROLES.STUDENT,
      status,
    },
  });
  if (!programId) return { user, profile: null };
  const profile = await prisma.studentProfile.create({
    data: {
      userId: user.id,
      createdById: user.id,
      enrollments: { create: { programId, createdById: user.id } },
    },
  });
  return { user, profile };
}

describe("taking an address back from a stray sign-up", () => {
  it("absorbs a stub that never got as far as onboarding", async () => {
    const { prog, pupil } = await setup();
    await allocation({ studentId: pupil.id, programId: prog.id, minutes: 300 });
    const stray = await stub("iborhimovh751@gmail.com");

    const state = await setStudentEmail(
      null,
      form({ studentProfileId: pupil.id, email: "iborhimovh751@gmail.com" })
    );

    expect(state).toMatchObject({ ok: true });
    await expect(
      prisma.user.findUnique({ where: { id: stray.user.id } })
    ).resolves.toBeNull();
    const moved = await prisma.user.findUnique({
      where: { email: "iborhimovh751@gmail.com" },
    });
    expect(moved?.id).toBe(pupil.userId);
    // The hours were never in doubt: they hang off the user id, not the email.
    await expect(
      prisma.hourAllocation.count({ where: { studentId: pupil.id } })
    ).resolves.toBe(1);
  });

  it("absorbs a stub that finished onboarding, and its notice leaves with it", async () => {
    const { prog, boss, pupil } = await setup();
    const stray = await stub("taken@test.invalid", prog.id);
    await prisma.notification.create({
      data: {
        userId: boss.id,
        actorId: stray.user.id,
        type: NOTIFICATION_TYPES.STUDENT_SIGNUP,
        message: "Second Account signed up and is awaiting approval.",
        href: `/students/${stray.profile!.id}`,
      },
    });

    const state = await setStudentEmail(
      null,
      form({ studentProfileId: pupil.id, email: "taken@test.invalid" })
    );

    expect(state).toMatchObject({ ok: true });
    await expect(prisma.user.count()).resolves.toBe(3); // boss, creator, pupil
    await expect(
      prisma.studentProfile.findUnique({ where: { id: stray.profile!.id } })
    ).resolves.toBeNull();
    // The dead link it would have left in the admin inbox goes too.
    await expect(
      prisma.notification.count({ where: { actorId: stray.user.id } })
    ).resolves.toBe(0);
  });

  it("absorbs an ACTIVE account that sits in no program and holds nothing", async () => {
    const { pupil } = await setup();
    const stray = await stub("empty@test.invalid", undefined, USER_STATUS.ACTIVE);

    const state = await setStudentEmail(
      null,
      form({ studentProfileId: pupil.id, email: "empty@test.invalid" })
    );

    expect(state).toMatchObject({ ok: true });
    await expect(
      prisma.user.findUnique({ where: { id: stray.user.id } })
    ).resolves.toBeNull();
    await expect(
      prisma.user.findUnique({ where: { email: "empty@test.invalid" } })
    ).resolves.toMatchObject({ id: pupil.userId });
  });

  it("refuses an ACTIVE account that is still enrolled somewhere", async () => {
    const { prog, pupil } = await setup();
    const stray = await stub("enrolled@test.invalid", prog.id, USER_STATUS.ACTIVE);

    const state = await setStudentEmail(
      null,
      form({ studentProfileId: pupil.id, email: "enrolled@test.invalid" })
    );

    expect(state).toMatchObject({ ok: false });
    await expect(
      prisma.user.findUnique({ where: { id: stray.user.id } })
    ).resolves.not.toBeNull();
  });

  it("refuses an address a real account already holds", async () => {
    const { pupil } = await setup();
    const other = await student({ name: "Other Student" });
    await prisma.user.update({
      where: { id: other.userId },
      data: { email: "real@test.invalid" },
    });

    const state = await setStudentEmail(
      null,
      form({ studentProfileId: pupil.id, email: "real@test.invalid" })
    );

    expect(state).toMatchObject({ ok: false });
    await expect(
      prisma.user.findUnique({ where: { email: "real@test.invalid" } })
    ).resolves.toMatchObject({ id: other.userId });
  });

  it("refuses a stub anything was ever logged against", async () => {
    const { prog, pupil } = await setup();
    const stray = await stub("busy@test.invalid", prog.id);
    const teacher = await mentor("Teacher");
    await session({
      studentId: stray.profile!.id,
      programId: prog.id,
      mentorId: teacher.id,
      minutes: 60,
    });

    const state = await setStudentEmail(
      null,
      form({ studentProfileId: pupil.id, email: "busy@test.invalid" })
    );

    expect(state).toMatchObject({ ok: false });
    await expect(
      prisma.user.findUnique({ where: { id: stray.user.id } })
    ).resolves.not.toBeNull();
  });

  it("refuses a stub signed up to a program the admin does not run", async () => {
    const { pupil } = await setup();
    const imkon = await program("Imkon");
    const stray = await stub("elsewhere@test.invalid", imkon.id);

    const state = await setStudentEmail(
      null,
      form({ studentProfileId: pupil.id, email: "elsewhere@test.invalid" })
    );

    expect(state).toMatchObject({ ok: false });
    await expect(
      prisma.user.findUnique({ where: { id: stray.user.id } })
    ).resolves.not.toBeNull();
  });

  it("still refuses a non-student's address", async () => {
    const { pupil } = await setup();
    const teacher = await mentor("Teacher");
    await prisma.user.update({
      where: { id: teacher.id },
      data: { email: "mentor@test.invalid" },
    });

    const state = await setStudentEmail(
      null,
      form({ studentProfileId: pupil.id, email: "mentor@test.invalid" })
    );

    expect(state).toMatchObject({ ok: false });
  });

  it("changes a free address exactly as before", async () => {
    const { pupil } = await setup();

    const state = await setStudentEmail(
      null,
      form({ studentProfileId: pupil.id, email: "free@test.invalid" })
    );

    expect(state).toMatchObject({ ok: true });
    await expect(
      prisma.user.findUnique({ where: { id: pupil.userId } })
    ).resolves.toMatchObject({ email: "free@test.invalid" });
  });
});
