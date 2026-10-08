import { describe, expect, it } from "vitest";

import { mentorHasWorkedWith, mentorReaches } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { interviewsOfStudent } from "@/lib/student-interviews";
import { allocation, mentor, program, student } from "@/test/db";

/**
 * Mentors reading a student's practice interviews.
 *
 * Two things are pinned: WHO — a mentor who has held time with the student,
 * however long ago, and nobody who merely works in the same program — and WHAT:
 * the student's own side, with no partner answers, notes or feedback drafts.
 */
async function scene() {
  const p = await program("Global Admissions");
  const host = await student({ programId: p.id, name: "Aziza Karimova" });
  const guest = await student({ programId: p.id, name: "Bobur Aliyev" });
  const slot = await prisma.interviewSlot.create({
    data: { studentId: host.id, startsAt: new Date("2026-10-20T15:00:00Z"), minutes: 45 },
  });
  const interview = await prisma.peerInterview.create({
    data: {
      slotId: slot.id,
      hostId: host.id,
      guestId: guest.id,
      template: "university-admissions",
      hostNotes: "host private note",
      guestNotes: "guest private note",
    },
  });
  return { p, host, guest, interview };
}

describe("mentorHasWorkedWith", () => {
  it("is true for a mentor with an expired grant, false for one who only shares the program", async () => {
    const { p, host } = await scene();
    const past = await mentor("Past Mentor");
    const stranger = await mentor("Stranger");
    await prisma.mentorAssignment.create({ data: { mentorId: past.id, programId: p.id } });
    await prisma.mentorAssignment.create({ data: { mentorId: stranger.id, programId: p.id } });
    await allocation({ studentId: host.id, mentorId: past.id, minutes: 60, deadlineInDays: -10 });

    expect(await mentorHasWorkedWith(past, host)).toBe(true);
    expect(await mentorHasWorkedWith(stranger, host)).toBe(false);
    // The wider logging rule still lets the stranger reach them — the two
    // questions must stay different.
    expect(await mentorReaches(stranger, host)).toBe(true);
  });
});

describe("interviewsOfStudent", () => {
  it("returns only the student's own side and submitted feedback", async () => {
    const { host, guest, interview } = await scene();
    await prisma.interviewAnswer.createMany({
      data: [
        { interviewId: interview.id, studentId: host.id, questionIndex: 0, question: "Q?", text: "host answer" },
        { interviewId: interview.id, studentId: guest.id, questionIndex: 0, question: "Q?", text: "guest answer" },
      ],
    });
    await prisma.interviewFeedback.createMany({
      data: [
        { interviewId: interview.id, fromId: guest.id, summary: "sent", wentWell: "a", toImprove: "b", submittedAt: new Date() },
        { interviewId: interview.id, fromId: host.id, summary: "host draft" },
      ],
    });

    const [row] = await interviewsOfStudent(host.id);
    expect(row.notes).toBe("host private note");
    expect(row.partner.name).toBe("Bobur Aliyev");
    // A name and a face, never the classmate's address.
    expect(row.partner).not.toHaveProperty("email");
    expect(row.answers.map((a) => a.text)).toEqual(["host answer"]);
    expect(row.received?.summary).toBe("sent");
    expect(row.given).toBeNull();
    expect(JSON.stringify(row)).not.toContain("guest private note");
    expect(JSON.stringify(row)).not.toContain("guest answer");
  });

  it("reads the guest's side from the guest's page", async () => {
    const { guest } = await scene();
    const [row] = await interviewsOfStudent(guest.id);
    expect(row.notes).toBe("guest private note");
    expect(row.partner.name).toBe("Aziza Karimova");
  });
});
