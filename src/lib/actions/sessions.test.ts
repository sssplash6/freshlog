import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { USER_STATUS } from "@/lib/constants";
import { allocationSummary } from "@/lib/hours";
import { mentorCaseload } from "@/lib/queries";
import { programToday } from "@/lib/when";
import {
  admin,
  allocation,
  assignment,
  cohort,
  grant,
  mentor,
  pairing,
  program,
  student,
} from "@/test/db";

/**
 * What authorizes a mentor to log time for a student.
 *
 * Four things do. The plainest is the program: a mentor assigned to a program
 * may log hours with anybody enrolled in it, holding nothing and having been
 * granted nothing, because the meeting that a colleague's absence produced
 * happens before any admin hears about it. The other three outlive the
 * pairing — a grant, a session already logged, and a task, which can be MOVED
 * onto a mentor who holds no hours there and was never in that program.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { editSession, logSession } = await import("@/lib/actions/sessions");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const log = (studentProfileId: string, extra: Record<string, string> = {}) =>
  logSession(
    null,
    form({ studentProfileId, minutes: "30", date: "2026-09-03", ...extra })
  );

describe("logSession authorization", () => {
  it("accepts a mentor whose task it is, with no hours and no program pairing", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor("Umid");
    const task = await assignment({ studentId: s.id, mentorId: m.id });
    actor.value = m;

    const state = await log(s.id, { assignmentId: task.id });

    expect(state).toMatchObject({ ok: true });
    await expect(
      prisma.session.count({ where: { mentorId: m.id, studentId: s.id } })
    ).resolves.toBe(1);
  });

  it("accepts any mentor assigned to the program, holding nothing at all", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: p.id });
    actor.value = m;

    const state = await log(s.id);

    expect(state).toMatchObject({ ok: true });
    await expect(
      prisma.session.count({ where: { mentorId: m.id, studentId: s.id, programId: p.id } })
    ).resolves.toBe(1);
  });

  it("accepts a cohort-scoped mentor for a student in another cohort", async () => {
    const p = await program("Global Admissions");
    const [autumn, spring] = await Promise.all([
      cohort({ programId: p.id, name: "Autumn" }),
      cohort({ programId: p.id, name: "Spring" }),
    ]);
    const s = await student({ programId: p.id, cohortId: spring.id });
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: p.id, cohortId: autumn.id });
    actor.value = m;

    expect(await log(s.id)).toMatchObject({ ok: true });
  });

  it("charges the program the meeting was in, not the other one the student is in", async () => {
    const [mine, theirs] = await Promise.all([program("Mine"), program("Theirs")]);
    const s = await student({ programId: mine.id });
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: mine.id });
    // Enrolled in a program this mentor does not work in: it must not be
    // offered as the program the hours come out of.
    await prisma.studentEnrollment.create({
      data: { studentId: s.id, programId: theirs.id },
    });
    actor.value = m;

    expect(await log(s.id)).toMatchObject({ ok: true });
    await expect(
      prisma.session.findFirst({ where: { mentorId: m.id }, select: { programId: true } })
    ).resolves.toEqual({ programId: mine.id });
  });

  it("still refuses a mentor with no hours, no pairing and no task there", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor();
    actor.value = m;

    const state = await log(s.id);

    expect(state).toMatchObject({ ok: false, field: "studentProfileId" });
    await expect(prisma.session.count()).resolves.toBe(0);
  });

  it("accepts a mentor who holds hours there, task or no task", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor();
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 600 });
    actor.value = m;

    const state = await log(s.id);

    expect(state).toMatchObject({ ok: true });
  });
});

/**
 * An admin logging a session for somebody else.
 *
 * The hours are the MENTOR's wherever they are counted — the row, the
 * allocation, the student's notification — and the admin appears only where
 * the question is "who did this", which is the audit trail. What bounds it is
 * the admin's own grants: the program the hours land in has to be one of
 * theirs, whatever else the mentor happens to work in.
 */
describe("logSession on a mentor's behalf", () => {
  it("logs it in the mentor's name when the admin administers the program", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor("Umid");
    await pairing({ mentorId: m.id, programId: p.id });
    const a = await admin("Malika");
    await grant({ userId: a.id, programId: p.id });
    actor.value = a;

    const state = await log(s.id, { mentorId: m.id });

    expect(state).toMatchObject({ ok: true });
    const logged = await prisma.session.findFirstOrThrow({
      where: { studentId: s.id },
    });
    expect(logged.mentorId).toBe(m.id);
  });

  it("tells the mentor that a session was logged in their name", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor("Umid");
    await pairing({ mentorId: m.id, programId: p.id });
    const a = await admin("Malika");
    await grant({ userId: a.id, programId: p.id });
    actor.value = a;

    await log(s.id, { mentorId: m.id });

    const notice = await prisma.notification.findFirst({
      where: { userId: m.id },
    });
    expect(notice?.message).toContain("Malika");
    expect(notice?.message).toContain("in your name");
  });

  it("names the admin, not the mentor, as who moved the pool's hours", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor("Umid");
    await pairing({ mentorId: m.id, programId: p.id });
    await allocation({ studentId: s.id, mentorId: null, minutes: 600 });
    const a = await admin("Malika");
    await grant({ userId: a.id, programId: p.id });
    actor.value = a;

    await log(s.id, { mentorId: m.id });

    const changes = await prisma.hourAllotmentChange.findMany({
      where: { studentId: s.id },
    });
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.changedById === a.id)).toBe(true);
  });

  /**
   * The point of putting the mentor's id on the row rather than the admin's:
   * nothing downstream has to know that an admin typed it. The balance, the
   * mentor's own home and the student's ledger all key on
   * (student, program, mentor), so they read a session this mentor delivered —
   * which is what happened.
   */
  it("draws the hours down on the mentor's balance and shows in both homes", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor("Umid");
    await pairing({ mentorId: m.id, programId: p.id });
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 600 });
    const a = await admin("Malika");
    await grant({ userId: a.id, programId: p.id });
    actor.value = a;

    await log(s.id, { mentorId: m.id, minutes: "90" });

    // The student's own hours page, and every admin view of their ledger.
    const hours = await allocationSummary(s.id);
    const row = hours.perMentor.find((r) => r.mentor?.id === m.id);
    expect(row).toMatchObject({ completed: 90, remaining: 510 });

    // The mentor's home: their lifetime figure, and the student on their list.
    const caseload = await mentorCaseload(m.id);
    expect(caseload.delivered.minutes).toBe(90);
    expect(caseload.students.some((c) => c.profile.id === s.id)).toBe(true);
  });

  it("refuses an admin of another program", async () => {
    const mine = await program("Global Admissions");
    const theirs = await program("Master's");
    const s = await student({ programId: theirs.id });
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: theirs.id });
    const a = await admin();
    await grant({ userId: a.id, programId: mine.id });
    actor.value = a;

    const state = await log(s.id, { mentorId: m.id });

    expect(state).toMatchObject({ ok: false, field: "programId" });
    await expect(prisma.session.count()).resolves.toBe(0);
  });

  it("refuses a mentor naming a colleague", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const [one, two] = await Promise.all([mentor("One"), mentor("Two")]);
    await Promise.all([
      pairing({ mentorId: one.id, programId: p.id }),
      pairing({ mentorId: two.id, programId: p.id }),
    ]);
    actor.value = one;

    const state = await log(s.id, { mentorId: two.id });

    expect(state).toMatchObject({ ok: false, field: "mentorId" });
    await expect(prisma.session.count()).resolves.toBe(0);
  });

  it("refuses a mentor who is not active", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: p.id });
    await prisma.user.update({
      where: { id: m.id },
      data: { status: USER_STATUS.UNASSIGNED },
    });
    const a = await admin();
    await grant({ userId: a.id, programId: p.id });
    actor.value = a;

    const state = await log(s.id, { mentorId: m.id });

    expect(state).toMatchObject({ ok: false, field: "mentorId" });
  });
});

/**
 * Late logging: the meeting's date is what is held against the deadline.
 *
 * A mentor met a student late on the 13th, went to sleep, and came back two
 * days later to be told the hours had expired — the check had asked when the
 * log was typed. A session held while the hours were good spent them, and may
 * be logged for a week after the deadline; one held after it may not.
 */
describe("logSession against a deadline", () => {
  /** A program day `n` days from today, as the form sends it. */
  const day = (n: number) =>
    new Date(Date.parse(`${programToday()}T00:00:00.000Z`) + n * 86_400_000)
      .toISOString()
      .slice(0, 10);

  async function heldWith(deadlineInDays: number) {
    const p = await program("Global Admissions");
    const s = await student({ programId: p.id });
    const m = await mentor();
    const a = await allocation({ studentId: s.id, mentorId: m.id, minutes: 600 });
    await prisma.hourAllocation.update({
      where: { id: a.id },
      data: { deadline: new Date(`${day(deadlineInDays)}T00:00:00.000Z`) },
    });
    actor.value = m;
    return { s, m };
  }

  it("logs a session held before the deadline, two days after it passed", async () => {
    const { s, m } = await heldWith(-2);

    expect(await log(s.id, { date: day(-3) })).toMatchObject({ ok: true });
    await expect(
      prisma.session.count({ where: { mentorId: m.id, withinPlan: true } })
    ).resolves.toBe(1);
  });

  it("logs a session held on the deadline day itself, all day long", async () => {
    const { s } = await heldWith(0);

    expect(await log(s.id, { date: day(0) })).toMatchObject({ ok: true });
  });

  it("refuses a session dated after the deadline", async () => {
    const { s } = await heldWith(-2);

    expect(await log(s.id, { date: day(-1) })).toMatchObject({
      ok: false,
      field: "date",
    });
  });

  it("refuses once the late-logging week is over", async () => {
    const { s } = await heldWith(-8);

    expect(await log(s.id, { date: day(-9) })).toMatchObject({
      ok: false,
      field: "timeKind",
    });
  });

  it("still records it as extra hours after that", async () => {
    const { s } = await heldWith(-30);

    expect(await log(s.id, { date: day(-31), timeKind: "EXTRA" })).toMatchObject({
      ok: true,
    });
  });

  it("will not let a correction move an in-plan session past the deadline", async () => {
    const { s } = await heldWith(-2);
    await log(s.id, { date: day(-3) });
    const logged = await prisma.session.findFirstOrThrow({ where: { studentId: s.id } });

    const state = await editSession(
      null,
      form({ sessionId: logged.id, minutes: "30", date: day(-1) })
    );

    expect(state).toMatchObject({ ok: false });
  });

  it("still lets the notes on an old session be corrected", async () => {
    const { s } = await heldWith(-2);
    await log(s.id, { date: day(-3) });
    const logged = await prisma.session.findFirstOrThrow({ where: { studentId: s.id } });
    await prisma.hourAllocation.updateMany({
      where: { studentId: s.id },
      data: { deadline: new Date(`${day(-60)}T00:00:00.000Z`) },
    });
    await prisma.session.update({
      where: { id: logged.id },
      data: { date: new Date(`${day(-61)}T00:00:00.000Z`) },
    });

    const state = await editSession(
      null,
      form({ sessionId: logged.id, minutes: "30", date: day(-61), note: "Essay plan" })
    );

    expect(state).toMatchObject({ ok: true });
  });
});
