import { describe, expect, it } from "vitest";

import { adminScope } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { readablePrograms, staffFeedback } from "@/lib/screens/feedback";
import type { SearchParams } from "@/lib/filters";
import type { User } from "@/generated/prisma/client";
import { admin, grant, mentor, pairing, platformAdmin, program, session, student } from "@/test/db";

/**
 * Opening one mentor on /feedback: whose header the page leads with, and the
 * score it shows there. A click on a mentor used to narrow the page and leave
 * the reader at the table, with nothing on screen saying whose ratings
 * followed.
 */

/** A meeting the student rated `stars`, answered now. */
async function rated(studentId: string, mentorId: string, programId: string, stars: number, note: string | null = null) {
  const s = await session({ studentId, mentorId, programId, minutes: 60 });
  await prisma.session.update({
    where: { id: s.id },
    data: { studentAnswer: "CONFIRMED", studentRating: stars, studentNote: note, studentAnsweredAt: new Date() },
  });
}

async function read(user: User, params: SearchParams) {
  const programIds = await readablePrograms(user, await adminScope(user));
  return staffFeedback({ user, programIds, params, page: 1 });
}

/** Valera's shape: rated in two meetings and never on the form. */
async function scene() {
  const ga = await program("Global Admissions");
  const valera = await mentor("Valera Meetings");
  await pairing({ mentorId: valera.id, programId: ga.id });
  const aziz = await student({ programId: ga.id, name: "Aziz Tursunov" });
  await rated(aziz.id, valera.id, ga.id, 5, "Clear and kind.");
  await rated(aziz.id, valera.id, ga.id, 4);
  return { ga, valera, aziz };
}

describe("staffFeedback: one mentor opened", () => {
  it("leads with the mentor it is narrowed to, and their score from both kinds", async () => {
    const { valera, aziz } = await scene();
    await prisma.mentorFeedback.create({ data: { studentId: aziz.id, mentorId: valera.id, rating: 3, comment: "Fine." } });
    const page = await read(await platformAdmin(), { mentor: valera.id });
    expect(page.focus?.who).toMatchObject({ id: valera.id, name: "Valera Meetings" });
    expect(page.focus?.standing).toMatchObject({
      average: 4,
      total: 3,
      general: { count: 1, average: 3 },
      meetings: { count: 2, average: 4.5 },
    });
  });

  it("leads with nobody when no mentor is chosen", async () => {
    await scene();
    const page = await read(await platformAdmin(), {});
    expect(page.focus).toBeNull();
  });

  it("reads ?mentor=me as the reader, the Mine chip's address", async () => {
    const { ga, aziz } = await scene();
    const both = await platformAdmin("Admin Who Mentors");
    await pairing({ mentorId: both.id, programId: ga.id });
    await prisma.mentorFeedback.create({ data: { studentId: aziz.id, mentorId: both.id, rating: 2, comment: "Rushed." } });
    const page = await read(both, { mentor: "me" });
    expect(page.focus?.who.id).toBe(both.id);
    expect(page.focus?.standing).toMatchObject({ total: 1, average: 2 });
  });

  it("keeps the header for a mentor whose ratings the other filters all hide", async () => {
    const { valera } = await scene();
    const page = await read(await platformAdmin(), { mentor: valera.id, rating: "1" });
    expect(page.focus?.who.id).toBe(valera.id);
    expect(page.focus?.standing).toBeNull();
  });

  it("names no mentor outside the reader's programs, even by their id", async () => {
    const { ga } = await scene();
    const other = await program("Other Program");
    const elsewhere = await mentor("Elsewhere Mentor");
    await pairing({ mentorId: elsewhere.id, programId: other.id });
    const zara = await student({ programId: other.id, name: "Zara Elsewhere" });
    await rated(zara.id, elsewhere.id, other.id, 1, "Never came.");
    const a = await admin();
    await grant({ userId: a.id, programId: ga.id });
    const page = await read(a, { mentor: elsewhere.id });
    expect(page.focus).toBeNull();
  });
});
