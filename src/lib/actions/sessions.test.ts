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
 * Naming the agenda item a meeting went toward when nobody has set one up.
 *
 * Mentors asked for it: the agenda used to be only what an admin had named
 * while granting hours, so a meeting about anything else could say nothing
 * about its work but the note. A name typed or picked in the log adds an item
 * to the student's agenda with no budget — the hours are still the admin's to
 * plan — or goes to the open one already called that.
 */
describe("logSession naming an agenda item that isn't set up", () => {
  async function setUp() {
    const p = await program("Full Support");
    const s = await student({ programId: p.id });
    const m = await mentor("Valera");
    await pairing({ mentorId: m.id, programId: p.id });
    actor.value = m;
    return { p, s, m };
  }

  it("adds a typed name to the student's agenda, unbudgeted, and logs toward it", async () => {
    const { p, s, m } = await setUp();
    await assignment({ studentId: s.id, mentorId: m.id, purpose: "Strategy", position: 0 });

    const state = await log(s.id, { assignmentId: "__other__", agendaName: "  Mock interview " });

    expect(state).toMatchObject({ ok: true });
    const item = await prisma.assignment.findFirstOrThrow({
      where: { studentId: s.id, purpose: "Mock interview" },
    });
    expect(item).toMatchObject({
      programId: p.id,
      mentorId: m.id,
      minuteLimit: null,
      dueOn: null,
      createdById: m.id,
      position: 1,
    });
    const logged = await prisma.session.findFirstOrThrow({ where: { studentId: s.id } });
    expect(logged.assignmentId).toBe(item.id);
  });

  it("adds a picked preset the same way", async () => {
    const { s, m } = await setUp();

    const state = await log(s.id, { assignmentId: "new:Supplemental Essays" });

    expect(state).toMatchObject({ ok: true });
    const item = await prisma.assignment.findFirstOrThrow({ where: { studentId: s.id } });
    expect(item).toMatchObject({ purpose: "Supplemental Essays", mentorId: m.id, position: 0 });
    await expect(
      prisma.session.findFirstOrThrow({ where: { studentId: s.id } })
    ).resolves.toMatchObject({ assignmentId: item.id });
  });

  it("goes to the open item already called that instead of adding a second", async () => {
    const { s, m } = await setUp();
    const open = await assignment({ studentId: s.id, mentorId: m.id, purpose: "Supplemental Essays" });

    const state = await log(s.id, { assignmentId: "__other__", agendaName: "supplemental essays" });

    expect(state).toMatchObject({ ok: true });
    await expect(prisma.assignment.count({ where: { studentId: s.id } })).resolves.toBe(1);
    await expect(
      prisma.session.findFirstOrThrow({ where: { studentId: s.id } })
    ).resolves.toMatchObject({ assignmentId: open.id });
  });

  it("claims an unassigned open item of that name", async () => {
    const { s, m } = await setUp();
    const unassigned = await assignment({ studentId: s.id, mentorId: null, purpose: "Strategy" });

    expect(await log(s.id, { assignmentId: "new:Strategy" })).toMatchObject({ ok: true });

    await expect(prisma.assignment.count({ where: { studentId: s.id } })).resolves.toBe(1);
    await expect(
      prisma.assignment.findUniqueOrThrow({ where: { id: unassigned.id } })
    ).resolves.toMatchObject({ mentorId: m.id });
  });

  it("never logs onto a colleague's item of the same name", async () => {
    const { p, s, m } = await setUp();
    const colleague = await mentor("Umid");
    await pairing({ mentorId: colleague.id, programId: p.id });
    const theirs = await assignment({ studentId: s.id, mentorId: colleague.id, purpose: "Strategy" });

    expect(await log(s.id, { assignmentId: "new:Strategy" })).toMatchObject({ ok: true });

    const logged = await prisma.session.findFirstOrThrow({ where: { studentId: s.id } });
    expect(logged.assignmentId).not.toBe(theirs.id);
    await expect(
      prisma.assignment.findUniqueOrThrow({ where: { id: logged.assignmentId! } })
    ).resolves.toMatchObject({ purpose: "Strategy", mentorId: m.id });
  });

  it("asks for the name when Something else was picked and nothing typed", async () => {
    const { s } = await setUp();

    const state = await log(s.id, { assignmentId: "__other__", agendaName: "   " });

    expect(state).toMatchObject({ ok: false, field: "assignmentId" });
    await expect(prisma.session.count()).resolves.toBe(0);
    await expect(prisma.assignment.count()).resolves.toBe(0);
  });

  it("refuses a name past the length limit", async () => {
    const { s } = await setUp();

    const state = await log(s.id, { assignmentId: "__other__", agendaName: "x".repeat(101) });

    expect(state).toMatchObject({ ok: false, field: "assignmentId" });
    await expect(prisma.assignment.count()).resolves.toBe(0);
  });

  it("puts it in the mentor's name, and the admin's as who added it, when logged on their behalf", async () => {
    const { p, s, m } = await setUp();
    const a = await admin("Malika");
    await grant({ userId: a.id, programId: p.id });
    actor.value = a;

    expect(
      await log(s.id, { mentorId: m.id, assignmentId: "__other__", agendaName: "Strategy" })
    ).toMatchObject({ ok: true });

    await expect(
      prisma.assignment.findFirstOrThrow({ where: { studentId: s.id } })
    ).resolves.toMatchObject({ mentorId: m.id, createdById: a.id });
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
 * Deadlines are use-by dates, not walls: they change what the log SAYS, never
 * whether it lands.
 *
 * A mentor met a student late on the 13th, went to sleep, and came back two
 * days later to be told the hours had expired — the check had asked when the
 * log was typed. Then the expiry itself refused the meeting entirely, and a
 * session that had really happened could only be recorded as extra hours.
 * Neither holds now: the meeting's date charges the hours it names, whenever
 * it is logged, and logging past the deadline is marked on the receipt and
 * in what staff are told rather than refused.
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

  it("logs a session dated after the deadline, and says so", async () => {
    const { s } = await heldWith(-2);

    const state = await log(s.id, { date: day(-1) });

    if (!state?.ok) throw new Error("expected the log to succeed");
    expect(state.message).toContain("past the deadline");
    await expect(
      prisma.session.count({ where: { studentId: s.id, withinPlan: true } })
    ).resolves.toBe(1);
  });

  it("logs a session written down after the late-logging fortnight too", async () => {
    const { s } = await heldWith(-15);

    expect(await log(s.id, { date: day(-16) })).toMatchObject({ ok: true });
  });

  it("still records it as extra hours after that", async () => {
    const { s } = await heldWith(-30);

    expect(await log(s.id, { date: day(-31), timeKind: "EXTRA" })).toMatchObject({
      ok: true,
    });
  });

  it("logs for an admin on a mentor's behalf, past the deadline too", async () => {
    const { s, m } = await heldWith(-2);
    const a = await admin();
    await grant({ userId: a.id, programId: s.enrollments[0].programId });
    actor.value = a;

    expect(await log(s.id, { date: day(-1), mentorId: m.id })).toMatchObject({
      ok: true,
    });
    const logged = await prisma.session.findFirstOrThrow({
      where: { studentId: s.id },
    });
    expect(logged).toMatchObject({ mentorId: m.id, withinPlan: true });
  });

  it("lets a correction move an in-plan session past the deadline", async () => {
    const { s } = await heldWith(-2);
    await log(s.id, { date: day(-3) });
    const logged = await prisma.session.findFirstOrThrow({ where: { studentId: s.id } });

    const state = await editSession(
      null,
      form({ sessionId: logged.id, minutes: "30", date: day(-1) })
    );

    expect(state).toMatchObject({ ok: true });
    await expect(
      prisma.session.findFirstOrThrow({ where: { id: logged.id } })
    ).resolves.toMatchObject({ date: new Date(`${day(-1)}T00:00:00.000Z`) });
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

/**
 * A session records a meeting that has happened. "October 24" in a September
 * ledger — and in the notice that said the date had been corrected — came from
 * a day ahead of the program's today getting through.
 */
describe("a session's date", () => {
  const day = (n: number) =>
    new Date(Date.parse(`${programToday()}T00:00:00.000Z`) + n * 86_400_000)
      .toISOString()
      .slice(0, 10);

  async function asMentor() {
    const p = await program("Global Admissions");
    const s = await student({ programId: p.id });
    const m = await mentor();
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 600 });
    actor.value = m;
    return { s, m };
  }

  it("cannot be logged for a day that has not happened", async () => {
    const { s } = await asMentor();

    expect(await log(s.id, { date: day(1) })).toMatchObject({
      ok: false,
      error: expect.stringContaining("future"),
    });
    await expect(prisma.session.count()).resolves.toBe(0);
  });

  it("can be logged for today", async () => {
    const { s } = await asMentor();

    expect(await log(s.id, { date: day(0) })).toMatchObject({ ok: true });
  });

  it("cannot be corrected to a day that has not happened", async () => {
    const { s } = await asMentor();
    await log(s.id, { date: day(-3) });
    const logged = await prisma.session.findFirstOrThrow({ where: { studentId: s.id } });

    expect(
      await editSession(null, form({ sessionId: logged.id, minutes: "30", date: day(2) }))
    ).toMatchObject({ ok: false, error: expect.stringContaining("future") });
  });

  it("leaves a row already dated ahead correctable in everything but its date", async () => {
    const { s } = await asMentor();
    await log(s.id, { date: day(-3) });
    const logged = await prisma.session.findFirstOrThrow({ where: { studentId: s.id } });
    await prisma.session.update({
      where: { id: logged.id },
      data: { date: new Date(`${day(20)}T00:00:00.000Z`) },
    });

    expect(
      await editSession(
        null,
        form({ sessionId: logged.id, minutes: "45", date: day(20), note: "Essay plan" })
      )
    ).toMatchObject({ ok: true });
    // And moving it back to a real day is the fix the notice then describes.
    expect(
      await editSession(null, form({ sessionId: logged.id, minutes: "45", date: day(-1) }))
    ).toMatchObject({ ok: true });
    const notice = await prisma.notification.findFirst({
      where: { type: "SESSION_EDITED" },
      orderBy: { createdAt: "desc" },
    });
    expect(notice?.message).toMatch(/moved to .*\d{4} \(was .*\d{4}\)/);
  });
});
