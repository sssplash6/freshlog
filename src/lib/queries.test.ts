import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { logSessionOptions, mentorCaseload, mentorOverview } from "@/lib/queries";
import {
  allocation,
  assignment,
  cohort,
  enroll,
  inDays,
  mentor,
  pairing,
  program,
  session,
  student,
} from "@/test/db";

/**
 * "Who are my students?" — the question `/mentor` opens with.
 *
 * Hours and tasks are separate rows, and a task can be moved between mentors
 * on its own while the hours stay banked with whoever they were granted to. So
 * a caseload built only from hours answered this question with ten people for
 * a mentor whose list held dozens of students' work.
 */
describe("mentorCaseload", () => {
  /**
   * A bank-share holder's meetings, and a mentor's bank meetings, vanished
   * from Home's Completed while the admin's page for the same mentor counted
   * them (13 October 2026).
   */
  it("shows a bank share as the mentor's row, and counts bank meetings as completed", async () => {
    const p = await program("Full Support");
    const s = await student({ programId: p.id, name: "Azim" });
    const [milutin, other] = [await mentor("Milutin"), await mentor("Other")];
    await pairing({ mentorId: milutin.id, programId: p.id });
    await pairing({ mentorId: other.id, programId: p.id });
    const bank = await allocation({ studentId: s.id, minutes: 480 });
    await prisma.hourAllocation.update({ where: { id: bank.id }, data: { isBank: true } });
    const share = await allocation({ studentId: s.id, mentorId: milutin.id, minutes: 120 });
    await prisma.hourAllocation.update({ where: { id: share.id }, data: { fromBankShare: true } });
    // One bank meeting before the share, one on it.
    await session({ studentId: s.id, mentorId: milutin.id, minutes: 30, fromBank: true });
    await session({ studentId: s.id, mentorId: milutin.id, minutes: 45 });
    // Another mentor, with a grant kept from before the bank and a bank meeting.
    await allocation({ studentId: s.id, mentorId: other.id, minutes: 60 });
    await session({ studentId: s.id, mentorId: other.id, minutes: 60 });
    await session({ studentId: s.id, mentorId: other.id, minutes: 20, fromBank: true });

    const mine = (await mentorCaseload(milutin.id)).students;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      reach: "allocation",
      allocated: 120,
      completed: 45,
      remaining: 75,
      bankCompleted: 30,
    });

    const theirs = (await mentorCaseload(other.id)).students;
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ reach: "pool", bank: true, bankCompleted: 80 });
  });

  it("lists a student whose task is this mentor's, with no hours and no sessions", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id, name: "Guzal" });
    const m = await mentor("Umid");
    await assignment({ studentId: s.id, mentorId: m.id, purpose: "Essay writing" });

    const { students } = await mentorCaseload(m.id);

    expect(students).toHaveLength(1);
    expect(students[0]).toMatchObject({
      reach: "task",
      allocated: 0,
      remaining: 0,
      deadline: null,
    });
    expect(students[0].profile.id).toBe(s.id);
  });

  it("does not list a student over a task nobody owns yet", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor();
    await assignment({ studentId: s.id, mentorId: null });

    const { students } = await mentorCaseload(m.id);

    expect(students).toHaveLength(0);
  });

  it("keeps a student the mentor already holds hours with as one allocation row", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor();
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 600 });
    await assignment({ studentId: s.id, mentorId: m.id });

    const { students } = await mentorCaseload(m.id);

    expect(students).toHaveLength(1);
    expect(students[0]).toMatchObject({ reach: "allocation", allocated: 600 });
  });

  it("names a task student once, however many tasks of theirs are this mentor's", async () => {
    const p = await program("Master's");
    const s = await student({ programId: p.id });
    const m = await mentor();
    await assignment({ studentId: s.id, mentorId: m.id, purpose: "Essay writing" });
    await assignment({
      studentId: s.id,
      mentorId: m.id,
      purpose: "University list building",
      position: 1,
    });

    const { students } = await mentorCaseload(m.id);

    expect(students).toHaveLength(1);
    expect(students[0].reach).toBe("task");
  });
});

/**
 * Who the log picker offers — the mentor half of the permission model, read
 * back out of the query that builds the form.
 *
 * The rule is one sentence: a mentor assigned to a program may log hours with
 * anybody enrolled in that program. Every case below is a way the picker used
 * to disagree with `logSession`, and a picker that hides somebody the action
 * would have accepted is a permission the form invented.
 */
describe("who a mentor may log for", () => {
  const optionFor = (
    options: ReturnType<typeof logSessionOptions>,
    profileId: string
  ) => options.find((o) => o.profileId === profileId);

  it("offers everyone in the mentor's program, granted or not", async () => {
    const p = await program("Master's");
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: p.id });
    const s = await student({ programId: p.id, name: "Guzal" });

    const caseload = await mentorCaseload(m.id);
    const option = optionFor(logSessionOptions(caseload), s.id);

    expect(caseload.students).toHaveLength(0);
    expect(option?.programs).toEqual([
      expect.objectContaining({ value: p.id, balance: "No time allocated to you" }),
    ]);
  });

  it("ignores the cohort a pairing names", async () => {
    const p = await program("Global Admissions");
    const [autumn, spring] = await Promise.all([
      cohort({ programId: p.id, name: "Autumn" }),
      cohort({ programId: p.id, name: "Spring" }),
    ]);
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: p.id, cohortId: autumn.id });
    const s = await student({ programId: p.id, cohortId: spring.id });

    const options = logSessionOptions(await mentorCaseload(m.id));

    expect(optionFor(options, s.id)).toBeDefined();
  });

  it("keeps a student whose hours expired — logging still counts against them", async () => {
    const p = await program("Master's");
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: p.id });
    const s = await student({ programId: p.id });
    await allocation({
      studentId: s.id,
      mentorId: m.id,
      minutes: 600,
      deadlineInDays: -1,
    });

    const options = logSessionOptions(await mentorCaseload(m.id));

    expect(optionFor(options, s.id)?.programs[0].balance).toContain(
      "logging still counts against them"
    );
  });

  it("marks each student by what logging for them would do to the balance", async () => {
    const p = await program("Master's");
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: p.id });
    const [fine, none, over, expired] = await Promise.all([
      student({ programId: p.id, name: "Fine" }),
      student({ programId: p.id, name: "None" }),
      student({ programId: p.id, name: "Over" }),
      student({ programId: p.id, name: "Expired" }),
    ]);
    await allocation({ studentId: fine.id, mentorId: m.id, minutes: 600 });
    await allocation({ studentId: over.id, mentorId: m.id, minutes: 60 });
    await session({ studentId: over.id, mentorId: m.id, minutes: 180 });
    await allocation({ studentId: expired.id, mentorId: m.id, minutes: 600, deadlineInDays: -1 });

    const options = logSessionOptions(await mentorCaseload(m.id));
    const state = (id: string) => optionFor(options, id)?.programs[0].state;

    expect(state(fine.id)).toBe("ready");
    expect(state(none.id)).toBe("none");
    expect(state(over.id)).toBe("overdrawn");
    expect(state(expired.id)).toBe("expired");
    expect(optionFor(options, over.id)?.programs[0].balance).toBe(
      "Overdrawn by 2h — logging adds to it"
    );
    // Held at the bottom, so the default pick is never the spent one.
    expect(options[0].profileId).toBe(fine.id);
    expect(options.slice(-2).map((o) => o.profileId).sort()).toEqual(
      [over.id, expired.id].sort()
    );
  });

  it("offers only the programs of theirs the student is actually in", async () => {
    const [mine, theirs] = await Promise.all([program("Mine"), program("Theirs")]);
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: mine.id });
    await pairing({ mentorId: m.id, programId: theirs.id });
    const s = await student({ programId: mine.id });

    const options = logSessionOptions(await mentorCaseload(m.id));

    expect(optionFor(options, s.id)?.programs.map((x) => x.value)).toEqual([mine.id]);
  });

  it("offers both programs when the student is in two of theirs", async () => {
    const [mine, also] = await Promise.all([program("Mine"), program("Also mine")]);
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: mine.id });
    await pairing({ mentorId: m.id, programId: also.id });
    const s = await student({ programId: mine.id });
    await enroll({ studentId: s.id, programId: also.id });

    const options = logSessionOptions(await mentorCaseload(m.id));

    expect(optionFor(options, s.id)?.programs.map((x) => x.value).sort()).toEqual(
      [mine.id, also.id].sort()
    );
  });

  it("offers nobody from a program the mentor is not assigned to", async () => {
    const [mine, theirs] = await Promise.all([program("Mine"), program("Theirs")]);
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: mine.id });
    const outside = await student({ programId: theirs.id });

    const options = logSessionOptions(await mentorCaseload(m.id));

    expect(optionFor(options, outside.id)).toBeUndefined();
  });

  it("leaves out a student who has not been approved yet", async () => {
    const p = await program("Master's");
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: p.id });
    const s = await student({ programId: p.id, status: "PENDING" });

    const options = logSessionOptions(await mentorCaseload(m.id));

    expect(optionFor(options, s.id)).toBeUndefined();
  });
});

/**
 * The mentor page's program table is read as "what did this mentor do in this
 * program". A session drawn from a student's hour bank, or given out of plan,
 * charges none of the mentor's own grants — and a table summed from grants
 * alone read "0 min" for a program the mentor had met students in all month,
 * while the headline above it counted the same hours.
 */
describe("mentorOverview program rows", () => {
  it("counts a bank session in its program's Completed, and in its Missed", async () => {
    const p = await program("Full Support");
    const s = await student({ programId: p.id });
    const m = await mentor("Umid");
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 0 });
    await session({ studentId: s.id, mentorId: m.id, minutes: 60, fromBank: true });
    await session({ studentId: s.id, mentorId: m.id, minutes: 30, fromBank: true, attended: false });

    const { byProgram, totals } = await mentorOverview(m.id);

    expect(byProgram).toHaveLength(1);
    expect(byProgram[0]).toMatchObject({ bankCompleted: 60, bankMissed: 30, allocated: 0 });
    // The headline's figure and the table's agree.
    expect(totals.delivered).toBe(60);
  });

  it("shows a program that has only bank or extra sessions, with no grant at all", async () => {
    const p = await program("Full Support");
    const s = await student({ programId: p.id });
    const m = await mentor();
    await session({ studentId: s.id, mentorId: m.id, minutes: 45, withinPlan: false });

    const { byProgram } = await mentorOverview(m.id);

    expect(byProgram.map((r) => r.id)).toEqual([p.id]);
    expect(byProgram[0]).toMatchObject({ extraAll: 45, students: 0 });
  });

  it("leaves a grant-drawn session out of the bank figures, and ignores voided ones", async () => {
    const p = await program("Flexible");
    const s = await student({ programId: p.id });
    const m = await mentor();
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 600 });
    await session({ studentId: s.id, mentorId: m.id, minutes: 60 });
    await session({ studentId: s.id, mentorId: m.id, minutes: 60, fromBank: true, status: "VOIDED" });

    const { byProgram } = await mentorOverview(m.id);

    expect(byProgram[0]).toMatchObject({ bankCompleted: 0, bankMissed: 0, extraAll: 0, used: 60 });
  });

  it("ignores the date window: the bank figures are the ledger's, like the grant's", async () => {
    const p = await program("Full Support");
    const s = await student({ programId: p.id });
    const m = await mentor();
    await session({ studentId: s.id, mentorId: m.id, minutes: 60, fromBank: true });

    const { byProgram } = await mentorOverview(m.id, { from: inDays(10), to: inDays(20) });

    expect(byProgram[0].bankCompleted).toBe(60);
    expect(byProgram[0].delivered).toBe(0);
  });
});
