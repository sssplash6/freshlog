import { describe, expect, it } from "vitest";

import { SESSION_STATUS } from "@/lib/constants";
import {
  allocationSummary,
  canBookOn,
  programTotals,
  remainingWithMentor,
  totalsByLevel,
  type StudentHoursRow,
} from "@/lib/hours";
import { allocation, mentor, session, student } from "@/test/db";

/**
 * The hours engine, pinned.
 *
 * These figures are the product: PRODUCT.md's promise is that "the numbers are
 * trusted by everyone". The UI reorganisation rebuilds nearly every page around
 * them and must not move one, so this file asserts the CURRENT behaviour of
 * `allocationSummary` — including the parts that look surprising and are
 * deliberate (a no-show charges, EXTRA charges nothing, an expired allocation
 * forfeits its unused minutes but keeps an overdraw).
 *
 * Written before the first token changed. If a later phase makes one of these
 * fail, the phase is wrong until proven otherwise.
 */
describe("allocationSummary", () => {
  it("counts an attended in-plan session against the allocation", async () => {
    const s = await student();
    const m = await mentor();
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 600 });
    await session({ studentId: s.id, mentorId: m.id, minutes: 90 });

    const summary = await allocationSummary(s.id);

    expect(summary.allotted).toBe(600);
    expect(summary.used).toBe(90);
    expect(summary.completed).toBe(90);
    expect(summary.missed).toBe(0);
    expect(summary.extra).toBe(0);
    expect(summary.forfeited).toBe(0);
    expect(summary.remaining).toBe(510);

    expect(summary.perMentor).toHaveLength(1);
    expect(summary.perMentor[0]).toMatchObject({
      allocated: 600,
      completed: 90,
      missed: 0,
      remaining: 510,
      forfeited: 0,
      expired: false,
    });
  });

  it("forfeits the unused minutes of an allocation whose deadline has passed", async () => {
    const s = await student();
    const m = await mentor();
    await allocation({
      studentId: s.id,
      mentorId: m.id,
      minutes: 600,
      deadlineInDays: -1,
    });
    await session({ studentId: s.id, mentorId: m.id, minutes: 90 });

    const summary = await allocationSummary(s.id);

    expect(summary.allotted).toBe(600);
    expect(summary.used).toBe(90);
    expect(summary.forfeited).toBe(510);
    // Forfeited minutes are gone, not still spendable: allotted - used - forfeited.
    expect(summary.remaining).toBe(0);
    expect(summary.perMentor[0]).toMatchObject({
      forfeited: 510,
      remaining: 0,
      expired: true,
    });
  });

  it("charges a no-show and tallies it as missed", async () => {
    const s = await student();
    const m = await mentor();
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 600 });
    await session({ studentId: s.id, mentorId: m.id, minutes: 60, attended: false });

    const summary = await allocationSummary(s.id);

    expect(summary.used).toBe(60);
    expect(summary.missed).toBe(60);
    // Delivered nothing, but the time is spent.
    expect(summary.completed).toBe(0);
    expect(summary.remaining).toBe(540);
  });

  it("keeps an out-of-plan session outside every total", async () => {
    const s = await student();
    const m = await mentor();
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 600 });
    await session({
      studentId: s.id,
      mentorId: m.id,
      minutes: 60,
      withinPlan: false,
    });

    const summary = await allocationSummary(s.id);

    expect(summary.extra).toBe(60);
    expect(summary.used).toBe(0);
    expect(summary.completed).toBe(0);
    expect(summary.remaining).toBe(600);
    expect(summary.perMentor[0]).toMatchObject({ extra: 60, remaining: 600 });
  });

  it("returns the time of a voided session", async () => {
    const s = await student();
    const m = await mentor();
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 600 });
    await session({
      studentId: s.id,
      mentorId: m.id,
      minutes: 90,
      status: SESSION_STATUS.VOIDED,
    });

    const summary = await allocationSummary(s.id);

    expect(summary.used).toBe(0);
    expect(summary.completed).toBe(0);
    expect(summary.extra).toBe(0);
    expect(summary.remaining).toBe(600);
  });

  it("charges nothing for a rescheduled session", async () => {
    const s = await student();
    const m = await mentor();
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 600 });
    await session({
      studentId: s.id,
      mentorId: m.id,
      minutes: 90,
      status: SESSION_STATUS.RESCHEDULED,
    });

    const summary = await allocationSummary(s.id);

    expect(summary.used).toBe(0);
    expect(summary.remaining).toBe(600);
  });

  it("names a mentor who logged time without holding an allocation", async () => {
    const s = await student();
    const granted = await mentor("Granted");
    const ungranted = await mentor("Ungranted");
    await allocation({ studentId: s.id, mentorId: granted.id, minutes: 600 });
    await session({ studentId: s.id, mentorId: ungranted.id, minutes: 120 });

    const summary = await allocationSummary(s.id);

    // The overdraw has to be attributable, or the student reads a balance no
    // row explains.
    const derived = summary.perMentor.find((r) => r.mentor?.id === ungranted.id);
    expect(derived).toMatchObject({
      allocated: 0,
      completed: 120,
      remaining: -120,
      forfeited: 0,
      expired: false,
      deadline: null,
    });
    expect(summary.allotted).toBe(600);
    expect(summary.used).toBe(120);
    expect(summary.remaining).toBe(480);
  });

  it("reports an overdraw on a live allocation without forfeiting anything", async () => {
    const s = await student();
    const m = await mentor();
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 100 });
    await session({ studentId: s.id, mentorId: m.id, minutes: 150 });

    const summary = await allocationSummary(s.id);

    expect(summary.remaining).toBe(-50);
    expect(summary.forfeited).toBe(0);
    expect(summary.perMentor[0]).toMatchObject({ remaining: -50, forfeited: 0 });
  });

  it("counts the unassigned pool toward the allotment and spends nothing from it", async () => {
    const s = await student();
    await allocation({ studentId: s.id, mentorId: null, minutes: 300 });

    const summary = await allocationSummary(s.id);

    expect(summary.allotted).toBe(300);
    expect(summary.used).toBe(0);
    expect(summary.remaining).toBe(300);
    expect(summary.perMentor[0]).toMatchObject({
      mentor: null,
      allocated: 300,
      remaining: 300,
    });
  });

  it("sums the amount paid across allocations that record one", async () => {
    const s = await student();
    const a = await mentor("A");
    const b = await mentor("B");
    await allocation({
      studentId: s.id,
      mentorId: a.id,
      minutes: 600,
      amountPaid: 5000,
    });
    await allocation({
      studentId: s.id,
      mentorId: b.id,
      minutes: 300,
      amountPaid: 2500,
    });

    const summary = await allocationSummary(s.id);

    expect(summary.paid).toBe(7500);
    expect(summary.allotted).toBe(900);
  });
});

describe("remainingWithMentor", () => {
  it("is null when the pairing holds no allocation", async () => {
    const s = await student();
    const m = await mentor();

    expect(
      await remainingWithMentor(s.id, s.enrollments[0].programId, m.id)
    ).toBeNull();
  });

  it("counts only that mentor's charging sessions", async () => {
    const s = await student();
    const mine = await mentor("Mine");
    const other = await mentor("Other");
    await allocation({ studentId: s.id, mentorId: mine.id, minutes: 600 });
    await session({ studentId: s.id, mentorId: mine.id, minutes: 90 });
    await session({ studentId: s.id, mentorId: other.id, minutes: 60 });
    await session({
      studentId: s.id,
      mentorId: mine.id,
      minutes: 30,
      withinPlan: false,
    });

    expect(
      await remainingWithMentor(s.id, s.enrollments[0].programId, mine.id)
    ).toBe(510);
  });
});

describe("programTotals", () => {
  /** A student row with everything zero, so each test states only what it means. */
  const row = (over: Partial<StudentHoursRow> = {}): StudentHoursRow => ({
    allottedMinutes: 0,
    completedMinutes: 0,
    missedMinutes: 0,
    remainingMinutes: 0,
    forfeitedMinutes: 0,
    extraMinutes: 0,
    amountPaid: 0,
    ...over,
  });

  it("has no students and no minutes when the program is empty", () => {
    expect(programTotals([])).toEqual({
      students: 0,
      allotted: 0,
      completed: 0,
      missed: 0,
      remaining: 0,
      forfeited: 0,
      extra: 0,
      paid: 0,
      overdrawn: 0,
    });
  });

  it("sums every field across students", () => {
    const totals = programTotals([
      row({ allottedMinutes: 600, completedMinutes: 120, remainingMinutes: 480 }),
      row({ allottedMinutes: 300, completedMinutes: 60, remainingMinutes: 240 }),
    ]);
    expect(totals.students).toBe(2);
    expect(totals.allotted).toBe(900);
    expect(totals.completed).toBe(180);
    expect(totals.remaining).toBe(720);
  });

  it("keeps the ledger's own arithmetic: remaining = allotted − used − forfeited", () => {
    // 10h granted, 3h delivered, 1h no-showed (charged), 2h forfeited.
    const used = 180 + 60;
    const totals = programTotals([
      row({
        allottedMinutes: 600,
        completedMinutes: 180,
        missedMinutes: 60,
        forfeitedMinutes: 120,
        remainingMinutes: 600 - used - 120,
      }),
    ]);
    expect(totals.remaining).toBe(totals.allotted - (totals.completed + totals.missed) - totals.forfeited);
    expect(totals.remaining).toBe(240);
  });

  it("leaves out-of-plan time outside every total", () => {
    const totals = programTotals([row({ allottedMinutes: 600, remainingMinutes: 600, extraMinutes: 90 })]);
    expect(totals.extra).toBe(90);
    // 10h granted, 10h left: the 90 extra minutes drew nothing down.
    expect(totals.allotted).toBe(600);
    expect(totals.remaining).toBe(600);
    expect(totals.completed).toBe(0);
  });

  it("counts overdrawn students rather than hiding them inside a positive sum", () => {
    // The cross-program dashboard's real shape: one student deep in the red,
    // three comfortable. A bare `remaining` sum reads as healthy.
    const totals = programTotals([
      row({ allottedMinutes: 0, completedMinutes: 465, remainingMinutes: -465 }),
      row({ allottedMinutes: 600, remainingMinutes: 600 }),
      row({ allottedMinutes: 600, remainingMinutes: 600 }),
      row({ allottedMinutes: 600, remainingMinutes: 600 }),
    ]);
    expect(totals.remaining).toBe(1335);
    expect(totals.overdrawn).toBe(1);
  });

  it("does not count a student at exactly zero as overdrawn", () => {
    expect(programTotals([row({ allottedMinutes: 600, completedMinutes: 600, remainingMinutes: 0 })]).overdrawn).toBe(0);
  });

  it("sums money, which only some programs track", () => {
    const totals = programTotals([row({ amountPaid: 12000 }), row({ amountPaid: 0 }), row({ amountPaid: 4500 })]);
    expect(totals.paid).toBe(16500);
    expect(totals.students).toBe(3);
  });
});

describe("totalsByLevel", () => {
  const row = (remainingMinutes: number, level: string | null) => ({
    allottedMinutes: remainingMinutes,
    completedMinutes: 0,
    missedMinutes: 0,
    remainingMinutes,
    forfeitedMinutes: 0,
    extraMinutes: 0,
    amountPaid: 0,
    level: level ? { id: level } : null,
  });

  it("splits by level and keeps the level-less rows, so the parts add up", () => {
    const rows = [row(60, "emerging"), row(120, "advanced"), row(30, "advanced"), row(15, null)];
    const split = totalsByLevel(rows);

    expect(split.get("emerging")).toMatchObject({ students: 1, remaining: 60 });
    expect(split.get("advanced")).toMatchObject({ students: 2, remaining: 150 });
    expect(split.get(null)).toMatchObject({ students: 1, remaining: 15 });
    const sum = [...split.values()].reduce((n, t) => n + t.remaining, 0);
    expect(sum).toBe(programTotals(rows).remaining);
  });
});

describe("canBookOn", () => {
  it("offers a calendar only against time still held", async () => {
    const s = await student();
    const held = await mentor();
    const spent = await mentor();
    const lapsed = await mentor();
    await allocation({ studentId: s.id, mentorId: held.id, minutes: 120 });
    await allocation({ studentId: s.id, mentorId: spent.id, minutes: 60 });
    await session({ studentId: s.id, mentorId: spent.id, minutes: 60 });
    await allocation({
      studentId: s.id,
      mentorId: lapsed.id,
      minutes: 120,
      deadlineInDays: -30,
    });

    const { perMentor } = await allocationSummary(s.id);
    const of = (id: string) => perMentor.find((h) => h.mentor?.id === id)!;
    expect(canBookOn(of(held.id))).toBe(true);
    expect(canBookOn(of(spent.id))).toBe(false);
    expect(canBookOn(of(lapsed.id))).toBe(false);
  });
});
