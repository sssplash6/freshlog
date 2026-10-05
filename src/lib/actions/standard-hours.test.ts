import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { USER_STATUS } from "@/lib/constants";
import { admin, cohort, grant, platformAdmin, program, student } from "@/test/db";

/**
 * A program's standard grant, from every door a student comes in by.
 *
 * The helper itself is tested in lib/standard-hours.test.ts; these pin that each
 * action that makes somebody a member of a program calls it, and that the one
 * membership that is not joining — an exchange visit — does not.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// The welcome email is queued with `after()`, which needs a request; what it
// says is not what these tests are about.
vi.mock("@/lib/email/welcome", async (original) => ({
  ...(await original<typeof import("@/lib/email/welcome")>()),
  sendWelcomeEmails: () => {},
}));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { createStudents, enrollStudent, moveStudent, approveStudent } = await import(
  "@/lib/actions/students"
);
const { sendOnExchange } = await import("@/lib/actions/exchanges");
const { setProgramStandardHours } = await import("@/lib/actions/programs");

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const one of Array.isArray(v) ? v : [v]) data.append(k, one);
  }
  return data;
}

async function level(name: string, minutes: number | null = 600, days: number | null = 90) {
  const p = await program(name);
  return prisma.program.update({
    where: { id: p.id },
    data: { standardMinutes: minutes, standardDays: days },
  });
}

const poolIn = (programId: string) =>
  prisma.hourAllocation.findMany({ where: { programId, mentorId: null } });

describe("createStudents", () => {
  it("gives every new student the program's standard hours", async () => {
    const beginner = await level("Beginner");
    actor.value = await platformAdmin();

    const state = await createStudents(
      null,
      form({
        programId: beginner.id,
        email: ["a@example.com", "b@example.com"],
        firstName: ["Aziza", "Bobur"],
        lastName: ["Karimova", "Aliev"],
        folderUrl: ["", ""],
      })
    );

    if (!state?.ok) throw new Error("expected the create to succeed");
    expect(state.message).toContain("Each has 10h to use within 90 days.");
    const pool = await poolIn(beginner.id);
    expect(pool.map((r) => r.minutes)).toEqual([600, 600]);
    await expect(prisma.hourAllotmentChange.count()).resolves.toBe(2);
  });

  it("grants nothing in a program with no standard", async () => {
    const plain = await level("Global Admissions", null, null);
    actor.value = await platformAdmin();

    const state = await createStudents(
      null,
      form({
        programId: plain.id,
        email: "c@example.com",
        firstName: "Aziza",
        lastName: "Karimova",
        folderUrl: "",
      })
    );

    expect(state).toMatchObject({ ok: true });
    await expect(prisma.hourAllocation.count()).resolves.toBe(0);
  });

  it("adopts the pending account a student made by signing in first", async () => {
    const beginner = await level("Beginner");
    actor.value = await platformAdmin();
    const stub = await prisma.user.create({
      data: {
        email: "early@example.com",
        name: "Google Name",
        role: "STUDENT",
        status: "PENDING",
      },
    });

    const state = await createStudents(
      null,
      form({
        programId: beginner.id,
        email: "early@example.com",
        firstName: "Early",
        lastName: "Bird",
        folderUrl: "",
      })
    );

    if (!state?.ok) throw new Error("expected the add to succeed");
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: stub.id },
      include: { studentProfile: { include: { enrollments: true } } },
    });
    expect(user).toMatchObject({ name: "Early Bird", status: "ACTIVE" });
    expect(user.studentProfile?.enrollments.map((e) => e.programId)).toEqual([
      beginner.id,
    ]);
    expect((await poolIn(beginner.id)).map((r) => r.minutes)).toEqual([600]);
    await expect(prisma.user.count({ where: { email: "early@example.com" } })).resolves.toBe(1);
  });

  it("still refuses an address that belongs to a mentor, and says so", async () => {
    const beginner = await level("Beginner");
    actor.value = await platformAdmin();
    await prisma.user.create({
      data: { email: "m@example.com", name: "Mina", role: "MENTOR", status: "ACTIVE" },
    });

    const state = await createStudents(
      null,
      form({
        programId: beginner.id,
        email: "m@example.com",
        firstName: "Mina",
        lastName: "Mentor",
        folderUrl: "",
      })
    );

    expect(state).toMatchObject({ ok: false });
    expect(state?.ok === false && state.error).toContain("registered as a mentor");
  });
});

describe("enrollStudent", () => {
  it("grants the new level's hours and leaves the old level's alone", async () => {
    const beginner = await level("Beginner", 600, 90);
    const advanced = await level("Advanced", 1200, 120);
    const s = await student({ programId: beginner.id });
    actor.value = await platformAdmin();

    const state = await enrollStudent(
      null,
      form({ studentProfileId: s.id, programId: advanced.id })
    );

    if (!state?.ok) throw new Error("expected the enrollment to succeed");
    expect(state.message).toContain("They have 20h to use within 120 days.");
    expect((await poolIn(advanced.id)).map((r) => r.minutes)).toEqual([1200]);
    await expect(poolIn(beginner.id)).resolves.toEqual([]);
  });
});

describe("moveStudent", () => {
  it("grants the standard of the program they are moved into", async () => {
    const wrong = await level("Advanced", null, null);
    const right = await level("Beginner", 600, 90);
    const s = await student({ programId: wrong.id });
    actor.value = await platformAdmin();

    const state = await moveStudent(
      null,
      form({ studentProfileId: s.id, programId: right.id })
    );

    expect(state).toMatchObject({ ok: true });
    expect((await poolIn(right.id)).map((r) => r.minutes)).toEqual([600]);
  });

  it("grants nothing for a move between two cohorts of the same program", async () => {
    const beginner = await level("Beginner", 600, 90);
    const [spring, autumn] = await Promise.all([
      cohort({ programId: beginner.id, name: "Spring" }),
      cohort({ programId: beginner.id, name: "Autumn" }),
    ]);
    const s = await student({ programId: beginner.id, cohortId: spring.id });
    actor.value = await platformAdmin();

    const state = await moveStudent(
      null,
      form({ studentProfileId: s.id, programId: beginner.id, cohortId: autumn.id })
    );

    expect(state).toMatchObject({ ok: true });
    await expect(prisma.hourAllocation.count()).resolves.toBe(0);
  });
});

describe("approveStudent", () => {
  it("grants the standard when a self sign-up is let in, not before", async () => {
    const beginner = await level("Beginner", 600, 90);
    const s = await student({ programId: beginner.id, status: USER_STATUS.PENDING });
    actor.value = await platformAdmin();

    await expect(prisma.hourAllocation.count()).resolves.toBe(0);
    const state = await approveStudent(null, form({ studentProfileId: s.id }));

    if (!state?.ok) throw new Error("expected the approval to succeed");
    expect(state.message).toContain("They have 10h to use within 90 days.");
    expect((await poolIn(beginner.id)).map((r) => r.minutes)).toEqual([600]);
  });
});

describe("sendOnExchange", () => {
  it("never gives a visitor the host program's standard", async () => {
    const home = await level("Imkon", null, null);
    const host = await level("Beginner", 600, 90);
    const s = await student({ programId: home.id });
    actor.value = await platformAdmin();

    const state = await sendOnExchange(
      null,
      form({ studentProfileId: s.id, toProgramId: host.id, minutes: "420", deadline: "2026-12-01" })
    );

    expect(state).toMatchObject({ ok: true });
    await expect(prisma.hourAllocation.count()).resolves.toBe(0);
  });
});

describe("setProgramStandardHours", () => {
  const set = (programId: string, minutes: string, days: string) =>
    setProgramStandardHours(null, form({ programId, minutes, days }));
  const stored = async (id: string) =>
    prisma.program.findUniqueOrThrow({
      where: { id },
      select: { standardMinutes: true, standardDays: true },
    });

  it("sets and clears a program's standard", async () => {
    const p = await level("Beginner", null, null);
    actor.value = await platformAdmin();

    await expect(set(p.id, "600", "90")).resolves.toMatchObject({ ok: true });
    await expect(stored(p.id)).resolves.toEqual({ standardMinutes: 600, standardDays: 90 });

    await expect(set(p.id, "", "")).resolves.toMatchObject({ ok: true });
    await expect(stored(p.id)).resolves.toEqual({ standardMinutes: null, standardDays: null });
  });

  it("refuses half a standard, zero minutes, and an implausible window", async () => {
    const p = await level("Beginner", null, null);
    actor.value = await platformAdmin();

    for (const [minutes, days] of [["600", ""], ["", "90"], ["0", "90"], ["600", "0"], ["600", "1096"], ["600", "1.5"]]) {
      await expect(set(p.id, minutes, days)).resolves.toMatchObject({ ok: false });
    }
    await expect(stored(p.id)).resolves.toEqual({ standardMinutes: null, standardDays: null });
  });

  it("is refused to an admin of another program", async () => {
    const mine = await level("Imkon", null, null);
    const theirs = await level("Beginner", null, null);
    const other = await admin("Other");
    await grant({ userId: other.id, programId: mine.id });
    actor.value = other;

    await expect(set(theirs.id, "600", "90")).resolves.toMatchObject({ ok: false });
    await expect(stored(theirs.id)).resolves.toEqual({ standardMinutes: null, standardDays: null });
  });
});
