import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { allocationSummary } from "@/lib/hours";
import { TASK_BANK } from "@/lib/tasks";
import {
  admin,
  allocation,
  grant,
  mentor,
  pairing,
  program,
  session,
  student,
} from "@/test/db";

/**
 * The hour bank: one balance per student per program that every mentor's
 * meeting draws, granted from the Agenda list by an admin of the program.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { setMentorAllocation, removeMentorAllocation } = await import(
  "@/lib/actions/students"
);
const { logSession } = await import("@/lib/actions/sessions");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

/** A program with the bank on, its admin, and one enrolled student. */
async function setup(role = "ADMIN") {
  const prog = await program("Full Support");
  await prisma.program.update({ where: { id: prog.id }, data: { hourBank: true } });
  const boss = await admin("Boss");
  await grant({ userId: boss.id, programId: prog.id, role });
  const kid = await student({ programId: prog.id });
  actor.value = boss;
  return { prog, boss, kid };
}

const addBank = (
  kid: { id: string },
  prog: { id: string },
  extra: Record<string, string> = {}
) =>
  setMentorAllocation(
    null,
    form({
      studentProfileId: kid.id,
      programId: prog.id,
      mode: "add",
      task: TASK_BANK,
      minutes: "600",
      deadline: "2027-06-01",
      ...extra,
    })
  );

describe("granting an hour bank", () => {
  it("makes one mentor-less bank row, with no task and no payment asked", async () => {
    const { prog, kid } = await setup();
    await prisma.program.update({ where: { id: prog.id }, data: { tracksPayment: true } });

    const state = await addBank(kid, prog, { includePrevious: "no" });

    expect(state).toMatchObject({ ok: true });
    const rows = await prisma.hourAllocation.findMany({ where: { studentId: kid.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isBank: true, mentorId: null, minutes: 600, amountPaid: null });
    await expect(prisma.assignment.count({ where: { studentId: kid.id } })).resolves.toBe(0);
  });

  it("asks about past hours only for a NEW bank, and only when there are any", async () => {
    const { prog, kid } = await setup();
    const m = await mentor();
    // Nothing in the past: nothing to ask.
    await expect(addBank(kid, prog, { minutes: "30" })).resolves.toMatchObject({ ok: true });
    await prisma.hourAllocation.deleteMany();

    await session({ studentId: kid.id, mentorId: m.id, minutes: 60 });
    await expect(addBank(kid, prog)).resolves.toMatchObject({ ok: false });
    await expect(addBank(kid, prog, { includePrevious: "no" })).resolves.toMatchObject({ ok: true });
    // A top-up has nothing left to decide.
    await expect(addBank(kid, prog, { minutes: "60" })).resolves.toMatchObject({ ok: true });
    const bank = await prisma.hourAllocation.findFirstOrThrow({ where: { studentId: kid.id } });
    expect(bank.minutes).toBe(660);
  });

  it("is refused for a leader, and for a program without banks", async () => {
    const { prog, kid } = await setup("LEADER");
    await expect(addBank(kid, prog, { includePrevious: "no" })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("admin"),
    });

    await prisma.programStaff.updateMany({ data: { role: "ADMIN" } });
    await prisma.program.update({ where: { id: prog.id }, data: { hourBank: false } });
    await expect(addBank(kid, prog, { includePrevious: "no" })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("hour bank"),
    });
  });

  it("refuses unassigned time beside a bank, which no meeting would draw", async () => {
    const { prog, kid } = await setup();
    await addBank(kid, prog, { includePrevious: "no" });

    const state = await setMentorAllocation(
      null,
      form({
        studentProfileId: kid.id,
        programId: prog.id,
        mode: "add",
        minutes: "60",
        deadline: "2027-06-01",
      })
    );

    expect(state).toMatchObject({ ok: false, error: expect.stringContaining("hour bank") });
  });
});

describe("giving a mentor a share of the bank", () => {
  const give = (
    kid: { id: string },
    prog: { id: string },
    mentorId: string,
    extra: Record<string, string> = {}
  ) =>
    setMentorAllocation(
      null,
      form({
        studentProfileId: kid.id,
        programId: prog.id,
        mentorId,
        mode: "add",
        minutes: "120",
        deadline: "2027-06-01",
        ...extra,
      })
    );

  it("moves the minutes out of the bank, so the student's total does not change", async () => {
    const { prog, kid } = await setup();
    const sega = await mentor("Sega");
    await addBank(kid, prog, { includePrevious: "no" });

    await expect(give(kid, prog, sega.id)).resolves.toMatchObject({ ok: true });

    const bank = await prisma.hourAllocation.findFirstOrThrow({ where: { isBank: true } });
    const share = await prisma.hourAllocation.findFirstOrThrow({ where: { mentorId: sega.id } });
    expect(bank.minutes).toBe(480);
    expect(share).toMatchObject({ minutes: 120, fromBankShare: true, isBank: false });
    expect((await allocationSummary(kid.id)).allotted).toBe(600);
  });

  it("is held to what the bank has left, to its date, and to its admins", async () => {
    const { prog, kid } = await setup();
    const sega = await mentor("Sega");
    await addBank(kid, prog, { minutes: "100", includePrevious: "no" });

    await expect(give(kid, prog, sega.id)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("left to give"),
    });
    await expect(
      give(kid, prog, sega.id, { minutes: "60", deadline: "2027-07-01" })
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("runs out") });

    await prisma.programStaff.updateMany({ data: { role: "LEADER" } });
    await expect(give(kid, prog, sega.id, { minutes: "60" })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("admin"),
    });
    await expect(prisma.hourAllocation.count({ where: { mentorId: sega.id } })).resolves.toBe(0);
  });

  it("is drawn by that mentor's meetings, while everybody else's draw the bank", async () => {
    const { prog, kid } = await setup();
    const [sega, other] = [await mentor("Sega"), await mentor("Other")];
    await pairing({ mentorId: sega.id, programId: prog.id });
    await pairing({ mentorId: other.id, programId: prog.id });
    await addBank(kid, prog, { includePrevious: "no" });
    await give(kid, prog, sega.id);

    for (const [who, minutes] of [
      [sega, "45"],
      [other, "30"],
    ] as const) {
      actor.value = who;
      const state = await logSession(
        null,
        form({ studentProfileId: kid.id, minutes, date: "2026-09-03" })
      );
      expect(state).toMatchObject({ ok: true });
    }

    const hours = await allocationSummary(kid.id);
    expect(hours.perMentor.find((r) => r.mentor?.id === sega.id)).toMatchObject({
      completed: 45,
      remaining: 75,
    });
    expect(hours.perMentor.find((r) => r.bank)).toMatchObject({ completed: 30, remaining: 450 });
  });

  it("gives back only what is unused when cut, and everything when removed", async () => {
    const { prog, boss, kid } = await setup();
    const sega = await mentor("Sega");
    await pairing({ mentorId: sega.id, programId: prog.id });
    await addBank(kid, prog, { includePrevious: "no" });
    await give(kid, prog, sega.id);
    const bankMinutes = async () =>
      (await prisma.hourAllocation.findFirstOrThrow({ where: { isBank: true } })).minutes;

    // Cut to 90: 30 go back.
    await expect(
      give(kid, prog, sega.id, { mode: "set", minutes: "90" })
    ).resolves.toMatchObject({ ok: true });
    expect(await bankMinutes()).toBe(510);

    // Removed with nothing logged: the rest goes back.
    await expect(
      removeMentorAllocation(
        null,
        form({ studentProfileId: kid.id, programId: prog.id, mentorId: sega.id })
      )
    ).resolves.toMatchObject({ ok: true });
    expect(await bankMinutes()).toBe(600);

    // Once Sega has used 60, the share can't be cut below it.
    await give(kid, prog, sega.id);
    actor.value = sega;
    await logSession(null, form({ studentProfileId: kid.id, minutes: "60", date: "2026-09-03" }));
    actor.value = boss;
    await expect(
      give(kid, prog, sega.id, { mode: "set", minutes: "30" })
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("already used") });
  });
});

describe("including the meetings already logged", () => {
  it("yes: the number entered is the bank's size, and per-mentor time is folded in", async () => {
    const { prog, kid } = await setup();
    const m = await mentor();
    await allocation({ studentId: kid.id, mentorId: m.id, minutes: 180 });
    await session({ studentId: kid.id, mentorId: m.id, minutes: 60 });

    await addBank(kid, prog, { includePrevious: "yes" });

    // The 60 already logged draws the bank; the grant's unused 120 folds in.
    const hours = await allocationSummary(kid.id);
    expect(hours.allotted).toBe(600);
    expect(hours.used).toBe(60);
    expect(hours.remaining).toBe(540);
    const bank = hours.perMentor.find((r) => r.bank)!;
    expect(bank).toMatchObject({ allocated: 600, completed: 60, remaining: 540 });
    // The mentor's grant no longer counts twice.
    await expect(
      prisma.hourAllocation.findFirstOrThrow({ where: { mentorId: m.id } })
    ).resolves.toMatchObject({ minutes: 0 });
    await expect(
      prisma.hourAllotmentChange.count({ where: { studentId: kid.id, mentorId: m.id } })
    ).resolves.toBe(1);
  });

  it("yes: logged beyond what was allocated still draws the bank", async () => {
    const { prog, kid } = await setup();
    const m = await mentor();
    await allocation({ studentId: kid.id, mentorId: m.id, minutes: 30 });
    await session({ studentId: kid.id, mentorId: m.id, minutes: 90 });

    await addBank(kid, prog, { includePrevious: "yes" });

    const hours = await allocationSummary(kid.id);
    expect(hours.allotted).toBe(600);
    expect(hours.remaining).toBe(510);
  });

  it("yes: a bank smaller than the past allocation still replaces it", async () => {
    const { prog, kid } = await setup();
    const m = await mentor();
    await allocation({ studentId: kid.id, mentorId: m.id, minutes: 900 });

    const state = await addBank(kid, prog, { includePrevious: "yes" });

    expect(state).toMatchObject({ ok: true });
    const hours = await allocationSummary(kid.id);
    expect(hours.allotted).toBe(600);
    expect(hours.remaining).toBe(600);
    await expect(
      prisma.hourAllocation.findFirstOrThrow({ where: { mentorId: m.id } })
    ).resolves.toMatchObject({ minutes: 0 });
  });

  it("no: the bank starts full and earlier meetings stay where they were logged", async () => {
    const { prog, kid } = await setup();
    const m = await mentor();
    await allocation({ studentId: kid.id, mentorId: m.id, minutes: 180 });
    await session({ studentId: kid.id, mentorId: m.id, minutes: 60 });

    await addBank(kid, prog, { includePrevious: "no" });

    const hours = await allocationSummary(kid.id);
    const bank = hours.perMentor.find((r) => r.bank)!;
    expect(bank).toMatchObject({ allocated: 600, completed: 0, remaining: 600 });
    expect(hours.perMentor.find((r) => r.mentor?.id === m.id)).toMatchObject({
      allocated: 180,
      completed: 60,
      remaining: 120,
    });
  });
});

describe("logging a meeting against a bank", () => {
  it("deducts from the bank whichever mentor delivered it, and spares their own grant", async () => {
    const { prog, kid } = await setup();
    const [a, b] = [await mentor("Aziza"), await mentor("Bobur")];
    await pairing({ mentorId: a.id, programId: prog.id });
    await pairing({ mentorId: b.id, programId: prog.id });
    await allocation({ studentId: kid.id, mentorId: a.id, minutes: 100 });
    await addBank(kid, prog, { includePrevious: "no" });

    for (const [who, minutes] of [
      [a, "45"],
      [b, "30"],
    ] as const) {
      actor.value = who;
      const state = await logSession(
        null,
        form({ studentProfileId: kid.id, minutes, date: "2026-09-03" })
      );
      expect(state).toMatchObject({ ok: true });
    }

    const hours = await allocationSummary(kid.id);
    const bank = hours.perMentor.find((r) => r.bank)!;
    expect(bank).toMatchObject({ completed: 75, remaining: 525 });
    // Aziza's own grant was not drawn, and Bobur has no derived overdraw row.
    expect(hours.perMentor.find((r) => r.mentor?.id === a.id)).toMatchObject({
      completed: 0,
      remaining: 100,
    });
    expect(hours.perMentor.find((r) => r.mentor?.id === b.id)).toBeUndefined();
    await expect(prisma.session.count({ where: { fromBank: true } })).resolves.toBe(2);
  });

  it("overdraws the bank with a warning, never a block, and extra time draws nothing", async () => {
    const { prog, kid } = await setup();
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: prog.id });
    await addBank(kid, prog, { minutes: "30", includePrevious: "no" });
    actor.value = m;

    const over = await logSession(
      null,
      form({ studentProfileId: kid.id, minutes: "45", date: "2026-09-03" })
    );
    expect(over).toMatchObject({ ok: true, message: expect.stringContaining("overdrawn") });

    const extra = await logSession(
      null,
      form({ studentProfileId: kid.id, minutes: "20", date: "2026-09-04", timeKind: "EXTRA" })
    );
    expect(extra).toMatchObject({ ok: true });

    const bank = (await allocationSummary(kid.id)).perMentor.find((r) => r.bank)!;
    expect(bank).toMatchObject({ completed: 45, remaining: -15, extra: 0 });
  });
});

describe("removing a bank", () => {
  it("is refused once a meeting has drawn it, and allowed before", async () => {
    const { prog, kid } = await setup();
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: prog.id });
    await addBank(kid, prog, { includePrevious: "no" });
    const remove = () =>
      removeMentorAllocation(
        null,
        form({ studentProfileId: kid.id, programId: prog.id, mentorId: "", bank: "1" })
      );

    actor.value = m;
    await logSession(null, form({ studentProfileId: kid.id, minutes: "30", date: "2026-09-03" }));
    actor.value = (await prisma.user.findFirstOrThrow({ where: { name: "Boss" } }));
    await expect(remove()).resolves.toMatchObject({ ok: false });

    await prisma.session.deleteMany();
    await expect(remove()).resolves.toMatchObject({ ok: true });
    await expect(prisma.hourAllocation.count({ where: { studentId: kid.id } })).resolves.toBe(0);
  });
});
