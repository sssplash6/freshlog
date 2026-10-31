import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { mentorRecordView } from "@/lib/screens/mentor-record";
import type { User } from "@/generated/prisma/client";
import { admin, grant, mentor, pairing, platformAdmin, program, session, student } from "@/test/db";

/**
 * The Ratings group on a mentor's record. It counted the written form alone,
 * so a mentor rated in twenty-three meetings and never on the form read "No
 * ratings written so far", with no way on to what those students said.
 */

/** A meeting the student rated `stars`, answered now. */
async function rated(studentId: string, mentorId: string, programId: string, stars: number) {
  const s = await session({ studentId, mentorId, programId, minutes: 60 });
  await prisma.session.update({
    where: { id: s.id },
    data: { studentAnswer: "CONFIRMED", studentRating: stars, studentAnsweredAt: new Date() },
  });
}

async function standing(viewer: User, mentorId: string) {
  const view = await mentorRecordView({
    viewer,
    mentor: { id: mentorId },
    isSelf: viewer.id === mentorId,
    edits: false,
    query: {},
    now: new Date(),
  });
  return view.standing;
}

describe("mentorRecordView: the Ratings group", () => {
  it("pools the written ratings and the rated meetings into one score", async () => {
    const ga = await program("Global Admissions");
    const m = await mentor("Valera Both");
    await pairing({ mentorId: m.id, programId: ga.id });
    const aziz = await student({ programId: ga.id });
    await prisma.mentorFeedback.create({ data: { studentId: aziz.id, mentorId: m.id, rating: 4 } });
    await rated(aziz.id, m.id, ga.id, 5);
    await rated(aziz.id, m.id, ga.id, 3);
    expect(await standing(await platformAdmin(), m.id)).toMatchObject({
      average: 4,
      total: 3,
      general: { count: 1, average: 4 },
      meetings: { count: 2, average: 4 },
    });
  });

  it("scores a mentor rated only in meetings", async () => {
    const ga = await program("Global Admissions");
    const m = await mentor("Valera Meetings");
    await pairing({ mentorId: m.id, programId: ga.id });
    const aziz = await student({ programId: ga.id });
    await rated(aziz.id, m.id, ga.id, 5);
    await rated(aziz.id, m.id, ga.id, 4);
    expect(await standing(await platformAdmin(), m.id)).toMatchObject({ average: 4.5, total: 2 });
  });

  it("counts only the meetings in the reader's own programs", async () => {
    const ga = await program("Global Admissions");
    const other = await program("Other Program");
    const m = await mentor("Two Programs");
    await pairing({ mentorId: m.id, programId: ga.id });
    await pairing({ mentorId: m.id, programId: other.id });
    await rated((await student({ programId: ga.id })).id, m.id, ga.id, 5);
    await rated((await student({ programId: other.id })).id, m.id, other.id, 1);
    const a = await admin();
    await grant({ userId: a.id, programId: ga.id });
    expect(await standing(a, m.id)).toMatchObject({ average: 5, total: 1 });
  });

  it("has no score for a mentor nobody has rated", async () => {
    const ga = await program("Global Admissions");
    const m = await mentor("Unrated");
    await pairing({ mentorId: m.id, programId: ga.id });
    expect(await standing(await platformAdmin(), m.id)).toBeNull();
  });
});
