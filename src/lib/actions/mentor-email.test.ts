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

describe("registering a mentor on an address that has already signed in", () => {
  it("absorbs the pending student sign-up and registers the mentor", async () => {
    const { createMentor } = await import("@/lib/actions/mentors");
    const prog = await program("Registering");
    actor.value = await platformAdmin("Registrar");
    const held = await stub("late@example.com", prog.id);

    const data = new FormData();
    data.append("email", "late@example.com");
    data.append("firstName", "Late");
    data.append("lastName", "Mentor");
    data.append("targets", `p:${prog.id}`);
    const result = await createMentor(null, data);

    expect(result?.ok).toBe(true);
    const user = await prisma.user.findUnique({ where: { email: "late@example.com" } });
    expect(user?.role).toBe(ROLES.MENTOR);
    expect(user?.id).not.toBe(held.user.id);
    expect(await prisma.studentProfile.findUnique({ where: { id: held.profile.id } })).toBeNull();
  });

  it("makes a real student a mentor too, on the same account", async () => {
    const { createMentor } = await import("@/lib/actions/mentors");
    const prog = await program("Refusing");
    const sat = await program("SAT Individuals");
    actor.value = await platformAdmin("Registrar Two");
    const real = await student({ programId: prog.id, name: "Real Student" });
    await allocation({ studentId: real.id, programId: prog.id, minutes: 60 });
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: real.userId } });

    const data = new FormData();
    data.append("email", owner.email);
    data.append("firstName", "Typed");
    data.append("lastName", "Differently");
    data.append("targets", `p:${sat.id}`);
    const result = await createMentor(null, data);

    expect(result).toMatchObject({ ok: true });
    expect((result as { message: string }).message).toMatch(
      /^Real Student \(.+\) is a student here, and now mentors too, in SAT Individuals/
    );
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: owner.id },
      include: { mentorAssignments: true, studentProfile: true, notifications: true },
    });
    expect(after.role).toBe(ROLES.STUDENT);
    expect(after.isMentor).toBe(true);
    expect(after.name).toBe("Real Student");
    expect(after.studentProfile?.id).toBe(real.id);
    expect(after.mentorAssignments.map((a) => a.programId)).toEqual([sat.id]);
    expect(after.notifications).toHaveLength(1);
    await expect(
      prisma.hourAllocation.count({ where: { studentId: real.id } })
    ).resolves.toBe(1);
    await expect(prisma.user.count({ where: { email: owner.email } })).resolves.toBe(1);

    // Asked again, they are a mentor already.
    const again = await createMentor(null, data);
    expect((again as { error: string }).error).toMatch(/already a mentor/);
  });

  it("refuses a student who has left the school", async () => {
    const { createMentor } = await import("@/lib/actions/mentors");
    const prog = await program("Left");
    actor.value = await platformAdmin("Registrar Four");
    const real = await student({ programId: prog.id, name: "Gone Student" });
    await allocation({ studentId: real.id, programId: prog.id, minutes: 60 });
    const owner = await prisma.user.update({
      where: { id: real.userId },
      data: { status: USER_STATUS.ARCHIVED },
    });

    const data = new FormData();
    data.append("email", owner.email);
    data.append("firstName", "Gone");
    data.append("lastName", "Student");
    data.append("targets", `p:${prog.id}`);
    const result = await createMentor(null, data);

    expect(result?.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/isn't active/);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(after.isMentor).toBe(false);
    await expect(
      prisma.mentorAssignment.count({ where: { mentorId: owner.id } })
    ).resolves.toBe(0);
  });
});

describe("registering a list of mentors at once", () => {
  it("registers every row it can into the same programs, and names the rest", async () => {
    const { createMentors } = await import("@/lib/actions/mentors");
    const prog = await program("Intake");
    actor.value = await platformAdmin("Registrar Three");
    await prisma.user.create({
      data: { email: "here@example.com", name: "Already Here", role: ROLES.MENTOR },
    });

    const data = new FormData();
    for (const [email, first, last] of [
      ["one@example.com", "First", "Mentor"],
      ["two@example.com", "Second", "Mentor"],
      ["here@example.com", "Already", "Here"],
      ["bad-address", "Bad", "Address"],
      ["solo@example.com", "Solo", ""],
      ["ONE@example.com", "First", "Again"],
    ]) {
      data.append("email", email);
      data.append("firstName", first);
      data.append("lastName", last);
    }
    data.append("targets", `p:${prog.id}`);
    const result = await createMentors(null, data);

    expect(result).toMatchObject({ ok: true });
    const message = (result as { message: string }).message;
    expect(message).toMatch(/^2 mentors registered in Intake/);
    expect(message).toMatch(/here@example\.com \(is already a mentor/);
    expect(message).toMatch(/bad-address \(not a valid email\)/);
    expect(message).toMatch(/solo@example\.com \(needs a first and last name\)/);
    const made = await prisma.user.findMany({
      where: { email: { in: ["one@example.com", "two@example.com"] } },
      include: { mentorAssignments: true },
    });
    expect(made.map((u) => [u.name, u.role, u.mentorAssignments[0]?.programId])).toEqual(
      expect.arrayContaining([
        ["First Mentor", ROLES.MENTOR, prog.id],
        ["Second Mentor", ROLES.MENTOR, prog.id],
      ])
    );
  });

  it("refuses the whole list when the programs are not the admin's", async () => {
    const { createMentors } = await import("@/lib/actions/mentors");
    const prog = await program("Not Theirs");
    const outsider = await prisma.user.create({
      data: { email: "outsider@example.com", name: "Out Sider", role: ROLES.ADMIN, status: USER_STATUS.ACTIVE },
    });
    actor.value = outsider;

    const data = new FormData();
    data.append("email", "new@example.com");
    data.append("firstName", "New");
    data.append("lastName", "Mentor");
    data.append("targets", `p:${prog.id}`);

    await expect(createMentors(null, data)).resolves.toMatchObject({ ok: false });
    await expect(prisma.user.count({ where: { email: "new@example.com" } })).resolves.toBe(0);
  });
});
