import { describe, expect, it } from "vitest";

import { adminScope } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { readablePrograms, staffFeedback } from "@/lib/screens/feedback";
import type { SearchParams } from "@/lib/filters";
import { grant, mentor, pairing, platformAdmin, program, session, student } from "@/test/db";

/**
 * What the Feedback page lists to a reader who also mentors. Since 30 October
 * 2026 an admin reads the ratings of their own meetings, without the student's
 * name, in the programs they administer; a leader's grant only reads, and
 * still does not list them.
 */

/** A meeting `studentId` rated `stars`, answered now. */
async function rated(
  studentId: string,
  mentorId: string,
  programId: string,
  stars: number,
  note: string | null = null
) {
  const s = await session({ studentId, mentorId, programId, minutes: 60 });
  await prisma.session.update({
    where: { id: s.id },
    data: {
      studentAnswer: "CONFIRMED",
      studentRating: stars,
      studentNote: note,
      studentAnsweredAt: new Date(),
    },
  });
  return s;
}

/** The page's reading for this reader, through the grants the page reads. */
async function read(
  userId: string,
  params: SearchParams = {},
  opts: { listOwnMeetings?: boolean } = {}
) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const programIds = await readablePrograms(user, await adminScope(user));
  return staffFeedback({ user, programIds, params, page: 1, ...opts });
}

/** A mentor of Global Admissions with one rated meeting there. */
async function valeraScene() {
  const ga = await program("Global Admissions");
  const valera = await mentor("Valera Arakelyan");
  await pairing({ mentorId: valera.id, programId: ga.id });
  const aziz = await student({ programId: ga.id, name: "Aziz Tursunov" });
  await rated(aziz.id, valera.id, ga.id, 3, "Ran short.");
  return { ga, valera, aziz };
}

describe("staffFeedback: the reader's own meetings", () => {
  it("lists an admin's own meeting ratings, with no student named", async () => {
    const { ga, valera } = await valeraScene();
    await grant({ userId: valera.id, programId: ga.id });
    const page = await read(valera.id, { mentor: "me" });
    expect(page.meetingStats._count).toBe(1);
    expect(page.meetingList).toEqual([
      expect.objectContaining({ studentRating: 3, studentNote: "Ran short.", student: null }),
    ]);
    expect(JSON.stringify(page.meetingList)).not.toContain("Aziz");
  });

  it("lists them to a platform admin who mentors", async () => {
    const ga = await program("Global Admissions");
    const founder = await platformAdmin("Valera Arakelyan");
    const aziz = await student({ programId: ga.id, name: "Aziz Tursunov" });
    await rated(aziz.id, founder.id, ga.id, 5, "Clear plan.");
    const page = await read(founder.id, { mentor: "me" });
    expect(page.meetingList.map((s) => [s.studentNote, s.student])).toEqual([["Clear plan.", null]]);
  });

  it("keeps them from a leader, whose card still counts them", async () => {
    const { ga, valera } = await valeraScene();
    await grant({ userId: valera.id, programId: ga.id, role: "LEADER" });
    const page = await read(valera.id, { mentor: "me" });
    expect(page.meetingList).toEqual([]);
    expect(page.meetingStats._count).toBe(0);
    expect(page.mentors.find((m) => m.who.id === valera.id)?.meetings.count).toBe(1);
    // So the empty list can say why it is empty.
    expect(page.ownWithheld).toBe(1);
  });

  it("withholds nothing from an admin", async () => {
    const { ga, valera } = await valeraScene();
    await grant({ userId: valera.id, programId: ga.id });
    expect((await read(valera.id, { mentor: "me" })).ownWithheld).toBe(0);
  });

  it("lists them only in the programs the reader administers", async () => {
    const { ga, valera } = await valeraScene();
    const imkon = await program("Imkon");
    await grant({ userId: valera.id, programId: ga.id });
    await grant({ userId: valera.id, programId: imkon.id, role: "LEADER" });
    const bek = await student({ programId: imkon.id, name: "Bek Imkon" });
    await rated(bek.id, valera.id, imkon.id, 2, "Late.");
    const page = await read(valera.id, { mentor: "me" });
    expect(page.meetingList.map((s) => s.studentNote)).toEqual(["Ran short."]);
  });

  it("still names the student on other mentors' meetings", async () => {
    const { ga, valera, aziz } = await valeraScene();
    await grant({ userId: valera.id, programId: ga.id });
    const other = await mentor("Dilnoza High");
    await rated(aziz.id, other.id, ga.id, 4, "Good.");
    const page = await read(valera.id);
    const byNote = new Map(page.meetingList.map((s) => [s.studentNote, s.student?.name ?? null]));
    expect(byNote.get("Good.")).toBe("Aziz Tursunov");
    expect(byNote.get("Ran short.")).toBeNull();
  });

  it("lists none of them when asked not to, as the app asks", async () => {
    const { ga, valera } = await valeraScene();
    await grant({ userId: valera.id, programId: ga.id });
    const page = await read(valera.id, { mentor: "me" }, { listOwnMeetings: false });
    expect(page.meetingList).toEqual([]);
  });

  it("counts both kinds for the filter summary, withheld ones too", async () => {
    const { ga, valera } = await valeraScene();
    await grant({ userId: valera.id, programId: ga.id, role: "LEADER" });
    const page = await read(valera.id, { mentor: "me" });
    // The overview counts the leader's own meeting, so the sentence does too.
    expect(page.matched).toBe(1);
    expect(page.ratedCount).toBe(1);
  });
});
