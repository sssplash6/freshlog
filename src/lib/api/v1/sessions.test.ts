import { beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { admin, assignment, DAY, enroll, grant, mentor, pairing, program, session, student } from "@/test/db";

/**
 * Who may read one session, and what each of them is told about it.
 *
 * The website has no page for one session, so there was no read rule to call.
 * This one is built from the rules the session actions enforce, and the last
 * test holds the two together: what `can` offers, the action then allows, and
 * what it withholds, the action refuses. So the actions run here too, as the
 * signed-in `actor`.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { answerSession, editSession, logSession, restoreSession, voidSession } = await import(
  "@/lib/actions/sessions"
);
const { readerFor, sessionFor } = await import("@/lib/api/v1/sessions");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

/** The day the fixture session is logged for. `session()` stores an instant, so it is pinned. */
const LOGGED_FOR = new Date("2026-10-22T00:00:00.000Z");
const daysAfter = (n: number) => new Date(LOGGED_FOR.getTime() + n * DAY);

/** A mentor's session with their student, in a program an admin runs: the three people who may read it. */
async function world() {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id, name: "Aziz Tursunov" });
  const studentUser = await prisma.user.findUniqueOrThrow({ where: { id: st.userId } });
  const mentorUser = await mentor("Akmal Karimov");
  await pairing({ mentorId: mentorUser.id, programId: p.id });
  const adminUser = await admin("Nodira Aliyeva");
  await grant({ userId: adminUser.id, programId: p.id });
  const created = await session({ studentId: st.id, mentorId: mentorUser.id, minutes: 60 });
  const s = await prisma.session.update({
    where: { id: created.id },
    data: { date: LOGGED_FOR, note: "Went through the essay." },
  });
  return { p, st, studentUser, mentorUser, adminUser, s };
}

beforeEach(() => {
  actor.value = null;
});

describe("sessionFor: who sees a session", () => {
  it("the student, the mentor who logged it and an admin of its program see it", async () => {
    const { studentUser, mentorUser, adminUser, s } = await world();
    for (const reader of [studentUser, mentorUser, adminUser]) {
      expect(await sessionFor(await readerFor(reader), s.id)).not.toBeNull();
    }
  });

  it("another mentor's session answers like a missing one", async () => {
    const { p, st, s } = await world();
    // In the same program, and with a session of their own with the same
    // student: the website's student page would show them this session.
    const otherMentor = await mentor("Umid Rashidov");
    await pairing({ mentorId: otherMentor.id, programId: p.id });
    await session({ studentId: st.id, mentorId: otherMentor.id, minutes: 30 });
    expect(await sessionFor(await readerFor(otherMentor), s.id)).toBeNull();
    expect(await sessionFor(await readerFor(otherMentor), "c-made-up")).toBeNull();
  });

  it("another student's session is not theirs to see", async () => {
    const { p, s } = await world();
    const other = await student({ programId: p.id, name: "Malika Rahimova" });
    const otherUser = await prisma.user.findUniqueOrThrow({ where: { id: other.userId } });
    expect(await sessionFor(await readerFor(otherUser), s.id)).toBeNull();
  });

  it("an admin of another program does not see it", async () => {
    const { s } = await world();
    const elsewhere = await admin("Dilnoza Yusupova");
    await grant({ userId: elsewhere.id, programId: (await program("Master's")).id });
    expect(await sessionFor(await readerFor(elsewhere), s.id)).toBeNull();
  });
});

describe("sessionFor: what each reader is told", () => {
  it("answers the contract's fields and nothing else, so the rating stays on the server", async () => {
    const { p, st, studentUser, mentorUser, s } = await world();
    const task = await assignment({ studentId: st.id, mentorId: mentorUser.id, purpose: "Main essay" });
    await prisma.session.update({ where: { id: s.id }, data: { assignmentId: task.id } });
    actor.value = { id: studentUser.id };
    expect(await answerSession(null, form({ sessionId: s.id, answer: "CONFIRMED", studentRating: "5" }))).toMatchObject({
      ok: true,
    });

    expect(await sessionFor(await readerFor(mentorUser), s.id)).toEqual({
      id: s.id,
      day: "2026-10-22",
      minutes: 60,
      attendance: "ATTENDED",
      kind: "PLAN",
      state: "ACTIVE",
      charged: true,
      answer: "CONFIRMED",
      answerNote: null,
      needsAnswer: false,
      student: { id: st.id, userId: st.userId, name: "Aziz Tursunov" },
      mentor: { id: mentorUser.id, name: "Akmal Karimov" },
      program: { id: p.id, name: "Global Admissions", colorIndex: p.colorIndex },
      task: { id: task.id, purpose: "Main essay" },
      note: "Went through the essay.",
      can: { edit: true, void: true, restore: false, answer: false },
    });
  });

  it("names a person with no name by their email", async () => {
    const { mentorUser, s } = await world();
    await prisma.user.update({ where: { id: mentorUser.id }, data: { name: null } });
    expect((await sessionFor(await readerFor(mentorUser), s.id))?.mentor.name).toBe(mentorUser.email);
  });

  it("a student's answer carries no mentor note", async () => {
    const { studentUser, mentorUser, adminUser, s } = await world();
    expect((await sessionFor(await readerFor(studentUser), s.id))?.note).toBeNull();
    expect((await sessionFor(await readerFor(mentorUser), s.id))?.note).toBe("Went through the essay.");
    expect((await sessionFor(await readerFor(adminUser), s.id))?.note).toBe("Went through the essay.");
  });

  it("gives the student no mentor note even when they also administer the program", async () => {
    const { p, studentUser, s } = await world();
    await grant({ userId: studentUser.id, programId: p.id });
    expect((await sessionFor(await readerFor(studentUser), s.id))?.note).toBeNull();
  });

  it("the student's own note goes to them, and to their mentor only on a dispute", async () => {
    const { studentUser, mentorUser, adminUser, s } = await world();
    const noteFor = async (reader: User) => (await sessionFor(await readerFor(reader), s.id))?.answerNote;
    const answer = (fields: Record<string, string>) => answerSession(null, form({ sessionId: s.id, ...fields }));
    actor.value = { id: studentUser.id };

    expect(await answer({ answer: "CONFIRMED", studentNote: "Clear and useful." })).toMatchObject({ ok: true });
    expect(await noteFor(studentUser)).toBe("Clear and useful.");
    expect(await noteFor(mentorUser)).toBeNull();
    expect(await noteFor(adminUser)).toBeNull();

    expect(await answer({ answer: "DISPUTED", studentNote: "It was 30 minutes, not 60." })).toMatchObject({ ok: true });
    expect(await noteFor(studentUser)).toBe("It was 30 minutes, not 60.");
    expect(await noteFor(mentorUser)).toBe("It was 30 minutes, not 60.");
    expect(await noteFor(adminUser)).toBe("It was 30 minutes, not 60.");
  });

  it("a session's day is the day it was logged for", async () => {
    const p = await program("Global Admissions");
    const st = await student({ programId: p.id });
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: p.id });
    actor.value = { id: m.id };
    const state = await logSession(null, form({ studentProfileId: st.id, minutes: "60", date: "2026-10-22" }));
    expect(state).toMatchObject({ ok: true });
    expect((await sessionFor(await readerFor(m), state?.ok ? state.receipt!.id : ""))?.day).toBe("2026-10-22");
  });

  it("asks the student for 30 days, and not on the 31st", async () => {
    const { studentUser, s } = await world();
    const reader = await readerFor(studentUser);
    expect((await sessionFor(reader, s.id, daysAfter(30)))?.needsAnswer).toBe(true);
    expect((await sessionFor(reader, s.id, daysAfter(31)))?.needsAnswer).toBe(false);
  });
});

describe("sessionFor: can", () => {
  it("can says what the actions then allow", async () => {
    const { p, studentUser, mentorUser, adminUser, s } = await world();
    const canFor = async (reader: User) => (await sessionFor(await readerFor(reader), s.id))?.can;

    // The mentor's own ACTIVE session: they may correct it or void it.
    expect(await canFor(mentorUser)).toEqual({ edit: true, void: true, restore: false, answer: false });
    actor.value = { id: mentorUser.id };
    expect(await voidSession(null, form({ sessionId: s.id }))).toMatchObject({ ok: true });

    // Voided, it can only be restored, and the student has nothing left to answer.
    expect(await canFor(mentorUser)).toEqual({ edit: false, void: false, restore: true, answer: false });
    expect((await canFor(studentUser))?.answer).toBe(false);
    actor.value = { id: studentUser.id };
    expect(await answerSession(null, form({ sessionId: s.id, answer: "CONFIRMED" }))).toMatchObject({ ok: false });
    actor.value = { id: mentorUser.id };
    expect(await restoreSession(null, form({ sessionId: s.id }))).toMatchObject({
      ok: true,
      message: "Session restored; hours charged again.",
    });

    // A read-only (LEADER) admin of the program reads it and changes nothing.
    const leader = await admin("Rustam Nazarov");
    await grant({ userId: leader.id, programId: p.id, role: "LEADER" });
    expect((await canFor(leader))?.edit).toBe(false);
    actor.value = { id: leader.id };
    expect(await editSession(null, form({ sessionId: s.id, minutes: "45", date: "2026-10-22" }))).toMatchObject({
      ok: false,
    });

    // The student may answer it; the mentor may not answer for them.
    expect((await canFor(studentUser))?.answer).toBe(true);
    actor.value = { id: studentUser.id };
    expect(await answerSession(null, form({ sessionId: s.id, answer: "CONFIRMED" }))).toMatchObject({ ok: true });
    expect((await canFor(mentorUser))?.answer).toBe(false);
    actor.value = { id: mentorUser.id };
    expect(await answerSession(null, form({ sessionId: s.id, answer: "CONFIRMED" }))).toMatchObject({ ok: false });

    // An admin who may write the program may correct a session they didn't log.
    expect((await canFor(adminUser))?.edit).toBe(true);
    actor.value = { id: adminUser.id };
    expect(await editSession(null, form({ sessionId: s.id, minutes: "45", date: "2026-10-22" }))).toMatchObject({
      ok: true,
    });
  });

  // Voiding is how a student is cleared off a program, so a voided session can
  // outlive the membership it was logged under, and `restoreSession` refuses it then.
  it("offers no restore once the student has left the session's program, as the action then refuses", async () => {
    const { p, st, mentorUser, adminUser, s } = await world();
    await enroll({ studentId: st.id, programId: (await program("Master's Program")).id });
    await prisma.session.update({ where: { id: s.id }, data: { status: "VOIDED" } });
    const restoreFor = async (reader: User) => (await sessionFor(await readerFor(reader), s.id))?.can.restore;
    expect(await restoreFor(mentorUser)).toBe(true);
    expect(await restoreFor(adminUser)).toBe(true);

    // Taken off Global Admissions, where it was logged, and still in the Master's Program: the session's
    // own program is the one asked about, not whether the student is in any.
    await prisma.studentEnrollment.deleteMany({ where: { studentId: st.id, programId: p.id } });
    for (const reader of [mentorUser, adminUser]) {
      expect(await restoreFor(reader)).toBe(false);
      actor.value = { id: reader.id };
      expect(await restoreSession(null, form({ sessionId: s.id }))).toMatchObject({
        ok: false,
        error: "The student is no longer in the program this session was logged in, so it can't be restored.",
      });
    }
  });

  it("the mentor who logged it, once they no longer mentor, still reads it and can't change it", async () => {
    const { mentorUser, s } = await world();
    // An admin who mentored, with the flag since turned off, and no program to write.
    const former = await prisma.user.update({ where: { id: mentorUser.id }, data: { role: "ADMIN", isMentor: false } });
    expect((await sessionFor(await readerFor(former), s.id))?.can).toEqual({
      edit: false,
      void: false,
      restore: false,
      answer: false,
    });
    actor.value = { id: former.id };
    expect(await voidSession(null, form({ sessionId: s.id }))).toMatchObject({ ok: false });
  });
});
