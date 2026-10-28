import { describe, expect, it } from "vitest";

import { mentorsOfStudent, studentsOfMentor } from "@/lib/interview-partners";
import { prisma } from "@/lib/prisma";
import { allocation, mentor, program, student } from "@/test/db";

/**
 * Who a mentor and a student see to practise with: the people they have
 * worked with, each with only the times offered in the other capacity.
 */
describe("interview partners", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const later = new Date("2026-10-25T15:00:00Z");

  it("lists a student's mentors and a mentor's students, and nobody else", async () => {
    const p = await program("Freshman Scholars");
    const aziza = await student({ programId: p.id, name: "Aziza Karimova" });
    const bekzod = await student({ programId: p.id, name: "Bekzod Tursunov" });
    const m = await mentor("Malika Mentor");
    await mentor("Never Met");
    await allocation({ studentId: aziza.id, mentorId: m.id, minutes: 60 });
    await prisma.interviewSlot.createMany({
      data: [
        { userId: m.id, asMentor: true, startsAt: later, minutes: 45 },
        { userId: aziza.userId, startsAt: later, minutes: 45 },
      ],
    });

    const mentors = await mentorsOfStudent(aziza.userId, now);
    expect(mentors.map((x) => x.name)).toEqual(["Malika Mentor"]);
    expect(mentors[0].interviewSlots).toHaveLength(1);
    expect(await mentorsOfStudent(bekzod.userId, now)).toEqual([]);

    const students = await studentsOfMentor(m.id, now);
    expect(students.map((x) => x.name)).toEqual(["Aziza Karimova"]);
    // Her student time, not the mentor's own.
    expect(students[0].interviewSlots).toHaveLength(1);
  });
});
