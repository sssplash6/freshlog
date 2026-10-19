import { describe, expect, it } from "vitest";

import { MergeRefused, mergeStudents } from "@/lib/merge-students";
import { prisma } from "@/lib/prisma";
import { allocation, enroll, mentor, program, session, student } from "@/test/db";

describe("mergeStudents", () => {
  it("moves the dropped account's programs, hours and sessions onto the kept one", async () => {
    const [ga, sat, m] = await Promise.all([program("Global Admissions"), program("SAT Individuals"), mentor()]);
    const keep = await student({ programId: ga.id, name: "Arslan Hodjaev" });
    const drop = await student({ programId: sat.id, name: "Arslan Khodjayev" });
    await allocation({ studentId: drop.id, mentorId: m.id, minutes: 600 });
    await session({ studentId: drop.id, mentorId: m.id, minutes: 60 });
    await prisma.studentProfile.update({ where: { id: drop.id }, data: { telegramUsername: "arslan" } });
    await prisma.notification.create({
      data: { userId: m.id, type: "X", message: "m", href: `/mentor/students/${drop.id}` },
    });

    const report = await prisma.$transaction((tx) => mergeStudents(tx, keep.id, drop.id));

    expect(report.moved).toMatchObject({ "program memberships": 1, "hour grants": 1, sessions: 1, "notification links": 1 });
    const kept = await prisma.studentProfile.findUniqueOrThrow({
      where: { id: keep.id },
      include: { enrollments: true, sessions: true, hourAllocations: true, user: true },
    });
    expect(kept.enrollments.map((e) => e.programId).sort()).toEqual([ga.id, sat.id].sort());
    expect(kept.sessions).toHaveLength(1);
    expect(kept.hourAllocations[0].minutes).toBe(600);
    expect(kept.telegramUsername).toBe("arslan");
    expect(kept.user.name).toBe("Arslan Hodjaev");
    expect(await prisma.studentProfile.findUnique({ where: { id: drop.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: drop.userId } })).toBeNull();
    expect((await prisma.notification.findFirstOrThrow()).href).toBe(`/mentor/students/${keep.id}`);
  });

  it("refuses two memberships of one program, and writes nothing", async () => {
    const [ga, sat, m] = await Promise.all([program("Global Admissions"), program("SAT Individuals"), mentor()]);
    const keep = await student({ programId: ga.id });
    const drop = await student({ programId: sat.id });
    await enroll({ studentId: drop.id, programId: ga.id });
    await session({ studentId: drop.id, programId: sat.id, mentorId: m.id, minutes: 60 });

    await expect(prisma.$transaction((tx) => mergeStudents(tx, keep.id, drop.id))).rejects.toThrow(MergeRefused);
    expect(await prisma.session.count({ where: { studentId: drop.id } })).toBe(1);
    expect(await prisma.studentEnrollment.count({ where: { studentId: drop.id } })).toBe(2);
  });
});
