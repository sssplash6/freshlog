import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  allocation,
  mentor,
  platformAdmin,
  program,
  session,
  student,
} from "@/test/db";
import { ROLES, USER_STATUS } from "@/lib/constants";

/**
 * A mentor registered under an address they cannot sign in with is pointed at
 * the one they can. Usually they have tried it already, and Google sign-in made
 * them a PENDING student there — so they land on the student home. The edit
 * absorbs that stub; an address held by a real account still refuses.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { updateMentor } = await import("@/lib/actions/mentors");

async function setup() {
  const prog = await program("Emerging Researchers");
  const boss = await platformAdmin("Boss");
  const teacher = await mentor("Khumoyunbek Ibrohimov");
  await prisma.mentorAssignment.create({
    data: { mentorId: teacher.id, programId: prog.id },
  });
  actor.value = boss;
  return { prog, teacher };
}

function form(mentorId: string, email: string, programId: string) {
  const data = new FormData();
  data.append("mentorId", mentorId);
  data.append("name", "Khumoyunbek Ibrohimov");
  data.append("email", email);
  data.append("targets", `p:${programId}`);
  return data;
}

/** What Google sign-in plus onboarding leave on an unknown address. */
async function stub(email: string, programId: string) {
  const user = await prisma.user.create({
    data: {
      email,
      name: "Khumoyunbek Ibrohimov",
      role: ROLES.STUDENT,
      status: USER_STATUS.PENDING,
    },
  });
  const profile = await prisma.studentProfile.create({
    data: {
      userId: user.id,
      createdById: user.id,
      enrollments: { create: { programId, createdById: user.id } },
    },
  });
  return { user, profile };
}

describe("pointing a mentor at the address they actually sign in with", () => {
  it("absorbs the student sign-up that address had made", async () => {
    const { prog, teacher } = await setup();
    const stray = await stub("k.ibrohimov@gmail.com", prog.id);

    const state = await updateMentor(
      null,
      form(teacher.id, "k.ibrohimov@gmail.com", prog.id)
    );

    expect(state).toMatchObject({ ok: true });
    await expect(
      prisma.user.findUnique({ where: { id: stray.user.id } })
    ).resolves.toBeNull();
    await expect(
      prisma.studentProfile.findUnique({ where: { id: stray.profile.id } })
    ).resolves.toBeNull();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: teacher.id } });
    expect(after.email).toBe("k.ibrohimov@gmail.com");
    expect(after.role).toBe(ROLES.MENTOR);
  });

  it("refuses an address a real student holds", async () => {
    const { prog, teacher } = await setup();
    const real = await student({ programId: prog.id });
    await allocation({ studentId: real.id, programId: prog.id, minutes: 60 });
    const { email } = await prisma.user.findUniqueOrThrow({
      where: { id: real.userId },
    });

    const state = await updateMentor(null, form(teacher.id, email, prog.id));

    expect(state).toMatchObject({ ok: false });
    await expect(
      prisma.user.findUnique({ where: { id: real.userId } })
    ).resolves.not.toBeNull();
  });

  it("refuses a pending sign-up that already has a session", async () => {
    const { prog, teacher } = await setup();
    const stray = await stub("busy@gmail.com", prog.id);
    await session({
      studentId: stray.profile.id,
      mentorId: teacher.id,
      programId: prog.id,
      minutes: 60,
    });

    const state = await updateMentor(null, form(teacher.id, "busy@gmail.com", prog.id));

    expect(state).toMatchObject({ ok: false });
    await expect(
      prisma.user.findUnique({ where: { id: stray.user.id } })
    ).resolves.not.toBeNull();
  });
});
