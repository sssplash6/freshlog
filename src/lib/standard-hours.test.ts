import { describe, expect, it } from "vitest";

import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { grantStandardHours, standardDeadline } from "@/lib/standard-hours";
import { admin, allocation, enroll, program, student } from "@/test/db";

async function levelProgram(minutes: number | null, days: number | null, name = "Beginner") {
  const p = await program(name);
  return prisma.program.update({
    where: { id: p.id },
    data: { standardMinutes: minutes, standardDays: days },
  });
}

describe("standardDeadline", () => {
  it("counts days from the program day the student joined, across a month end", () => {
    expect(standardDeadline("2026-09-29", 3).toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });

  it("stores the day the way a date field does, at UTC midnight", () => {
    expect(standardDeadline("2026-12-31", 90).toISOString()).toBe("2027-03-31T00:00:00.000Z");
  });
});

describe("grantStandardHours", () => {
  const today = "2026-09-03";

  it("does nothing in a program with no standard", async () => {
    const plain = await levelProgram(null, null);
    const s = await student({ programId: plain.id });
    const by = await admin();

    const made = await prisma.$transaction((tx) =>
      grantStandardHours(tx, { studentId: s.id, programId: plain.id, actorId: by.id, today })
    );

    expect(made).toBeNull();
    await expect(prisma.hourAllocation.count()).resolves.toBe(0);
    await expect(prisma.hourAllotmentChange.count()).resolves.toBe(0);
    await expect(prisma.notification.count()).resolves.toBe(0);
  });

  it("puts the standard in the student's pool, audited and announced", async () => {
    const level = await levelProgram(600, 90);
    const s = await student({ programId: level.id });
    const by = await admin();

    const made = await prisma.$transaction((tx) =>
      grantStandardHours(tx, { studentId: s.id, programId: level.id, actorId: by.id, today })
    );

    expect(made).toEqual({ minutes: 600, deadline: new Date("2026-12-02T00:00:00.000Z") });
    const rows = await prisma.hourAllocation.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      studentId: s.id,
      programId: level.id,
      mentorId: null,
      minutes: 600,
      deadline: new Date("2026-12-02T00:00:00.000Z"),
    });
    const trail = await prisma.hourAllotmentChange.findMany();
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      studentId: s.id,
      programId: level.id,
      mentorId: null,
      changedById: by.id,
      oldMinutes: 0,
      newMinutes: 600,
    });
    const notes = await prisma.notification.findMany();
    expect(notes).toHaveLength(1);
    expect(notes[0].userId).toBe(s.userId);
    expect(notes[0].message).toBe(
      `You were granted 10h in Beginner. They must be used by ${formatDate(new Date("2026-12-02T00:00:00.000Z"))}.`
    );
  });

  it("opens the hour bank instead of the pool where the program uses one", async () => {
    const level = await levelProgram(600, 90);
    await prisma.program.update({ where: { id: level.id }, data: { hourBank: true } });
    const s = await student({ programId: level.id });
    const by = await admin();

    await prisma.$transaction((tx) =>
      grantStandardHours(tx, { studentId: s.id, programId: level.id, actorId: by.id, today })
    );

    const rows = await prisma.hourAllocation.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mentorId: null, minutes: 600, isBank: true });
    const notes = await prisma.notification.findMany();
    expect(notes[0].message).toBe(
      `You were given an hour bank of 10h in Beginner. It must be used by ${formatDate(new Date("2026-12-02T00:00:00.000Z"))}.`
    );
  });

  it("gives nothing to a student who already holds hours in the program", async () => {
    const level = await levelProgram(600, 90);
    const s = await student({ programId: level.id });
    await allocation({ studentId: s.id, programId: level.id, minutes: 120 });
    const by = await admin();

    const made = await prisma.$transaction((tx) =>
      grantStandardHours(tx, { studentId: s.id, programId: level.id, actorId: by.id, today })
    );

    expect(made).toBeNull();
    await expect(prisma.hourAllocation.count()).resolves.toBe(1);
    await expect(prisma.hourAllotmentChange.count()).resolves.toBe(0);
  });

  it("does not count hours held in a different program", async () => {
    const beginner = await levelProgram(600, 90, "Beginner");
    const advanced = await levelProgram(1200, 120, "Advanced");
    const s = await student({ programId: beginner.id });
    await allocation({ studentId: s.id, programId: beginner.id, minutes: 600 });
    await enroll({ studentId: s.id, programId: advanced.id });
    const by = await admin();

    await prisma.$transaction((tx) =>
      grantStandardHours(tx, { studentId: s.id, programId: advanced.id, actorId: by.id, today })
    );

    const advancedRows = await prisma.hourAllocation.findMany({ where: { programId: advanced.id } });
    expect(advancedRows.map((r) => r.minutes)).toEqual([1200]);
    const beginnerRows = await prisma.hourAllocation.findMany({ where: { programId: beginner.id } });
    expect(beginnerRows.map((r) => r.minutes)).toEqual([600]);
  });
});
