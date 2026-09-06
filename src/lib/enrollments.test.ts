import { describe, expect, it } from "vitest";

import { canManageStudent, mentorReaches, studentScope } from "@/lib/authz";
import { allocationSummary, remainingWithMentor } from "@/lib/hours";
import { mentorCaseload, studentsWithHours } from "@/lib/queries";
import {
  admin,
  allocation,
  enroll,
  grant,
  mentor,
  pairing,
  platformAdmin,
  program,
  session,
  student,
} from "@/test/db";

/**
 * One student, several programs.
 *
 * `StudentProfile.programId` was a single column until 6 September 2026, and
 * every one of these behaviours was free while it existed: a student had one
 * program, so a balance had one program, an admin's scope reached all of a
 * student or none of them, and a session could not be logged against the wrong
 * pool because there was only one.
 *
 * None of that is free now. This file is the record of what the ledger has to
 * keep doing once a person can study in two places at once — and, more
 * importantly, of what it must NOT do: leak one program's hours into another
 * program's totals, or into another program's admin's screen.
 */

/** A student in two programs, one of which the admin holds. */
async function twoPrograms() {
  const [mine, theirs] = await Promise.all([program("Mine"), program("Theirs")]);
  const s = await student({ programId: mine.id });
  await enroll({ studentId: s.id, programId: theirs.id });
  return { mine, theirs, s };
}

describe("a balance belongs to a program, not to a student", () => {
  it("keeps two grants from the same mentor apart", async () => {
    const { mine, theirs, s } = await twoPrograms();
    const m = await mentor();
    await allocation({ studentId: s.id, programId: mine.id, mentorId: m.id, minutes: 600 });
    await allocation({ studentId: s.id, programId: theirs.id, mentorId: m.id, minutes: 300 });
    // Spent in the first program only.
    await session({ studentId: s.id, programId: mine.id, mentorId: m.id, minutes: 90 });

    expect(await remainingWithMentor(s.id, mine.id, m.id)).toBe(510);
    // The second program's grant is untouched: the same mentor, the same
    // student, a different ledger.
    expect(await remainingWithMentor(s.id, theirs.id, m.id)).toBe(300);
  });

  it("gives allocationSummary one row per program and totals them all", async () => {
    const { mine, theirs, s } = await twoPrograms();
    const m = await mentor();
    await allocation({ studentId: s.id, programId: mine.id, mentorId: m.id, minutes: 600 });
    await allocation({ studentId: s.id, programId: theirs.id, mentorId: m.id, minutes: 300 });
    await session({ studentId: s.id, programId: mine.id, mentorId: m.id, minutes: 90 });

    const all = await allocationSummary(s.id);
    expect(all.perMentor).toHaveLength(2);
    expect(all.allotted).toBe(900);
    expect(all.completed).toBe(90);
    expect(all.remaining).toBe(810);

    // The same question asked by an admin of one program only.
    const scoped = await allocationSummary(s.id, [mine.id]);
    expect(scoped.perMentor).toHaveLength(1);
    expect(scoped.perMentor[0].program.id).toBe(mine.id);
    expect(scoped.allotted).toBe(600);
    expect(scoped.remaining).toBe(510);
  });

  it("forfeits an expired grant without touching the live one", async () => {
    const { mine, theirs, s } = await twoPrograms();
    const m = await mentor();
    await allocation({
      studentId: s.id,
      programId: mine.id,
      mentorId: m.id,
      minutes: 600,
      deadlineInDays: -1,
    });
    await allocation({ studentId: s.id, programId: theirs.id, mentorId: m.id, minutes: 300 });

    const summary = await allocationSummary(s.id);
    expect(summary.forfeited).toBe(600);
    // 900 allotted, 600 gone, nothing used.
    expect(summary.remaining).toBe(300);
  });
});

describe("studentsWithHours, scoped to a reader's programs", () => {
  it("sums only the programs the reader holds, and names only those", async () => {
    const { mine, theirs, s } = await twoPrograms();
    const m = await mentor();
    await allocation({ studentId: s.id, programId: mine.id, mentorId: m.id, minutes: 600 });
    await allocation({ studentId: s.id, programId: theirs.id, mentorId: m.id, minutes: 300 });

    const [scoped] = await studentsWithHours(
      { id: s.id },
      { programIds: [mine.id] }
    );
    expect(scoped.allottedMinutes).toBe(600);
    // The other program is not named either — half a leak is still a leak.
    expect(scoped.enrollments.map((e) => e.programId)).toEqual([mine.id]);
    expect(scoped.byProgram.has(theirs.id)).toBe(false);

    const [whole] = await studentsWithHours({ id: s.id });
    expect(whole.allottedMinutes).toBe(900);
    expect(whole.byProgram.get(mine.id)?.allottedMinutes).toBe(600);
    expect(whole.byProgram.get(theirs.id)?.allottedMinutes).toBe(300);
  });

  it("adds each program's figures up to the student's own", async () => {
    const { mine, theirs, s } = await twoPrograms();
    const m = await mentor();
    await allocation({ studentId: s.id, programId: mine.id, mentorId: m.id, minutes: 600 });
    await allocation({ studentId: s.id, programId: theirs.id, mentorId: m.id, minutes: 300 });
    await session({ studentId: s.id, programId: mine.id, mentorId: m.id, minutes: 60 });
    await session({ studentId: s.id, programId: theirs.id, mentorId: m.id, minutes: 30 });

    const [row] = await studentsWithHours({ id: s.id });
    const parts = [...row.byProgram.values()];
    expect(parts.reduce((n, p) => n + p.allottedMinutes, 0)).toBe(
      row.allottedMinutes
    );
    expect(parts.reduce((n, p) => n + p.completedMinutes, 0)).toBe(
      row.completedMinutes
    );
    expect(parts.reduce((n, p) => n + p.remainingMinutes, 0)).toBe(
      row.remainingMinutes
    );
  });
});

describe("who may see a student in several programs", () => {
  it("lets an admin of ONE of their programs open them, and shows only that one", async () => {
    const { mine, theirs } = await twoPrograms();
    const a = await admin();
    await grant({ userId: a.id, programId: mine.id });

    const profile = { enrollments: [{ programId: mine.id }, { programId: theirs.id }] };
    expect(await canManageStudent(a, profile)).toBe(true);
    expect(await studentScope(a, profile)).toEqual([mine.id]);
  });

  it("refuses an admin who holds neither", async () => {
    const { mine, theirs, s } = await twoPrograms();
    const [a, elsewhere] = await Promise.all([admin(), program("Elsewhere")]);
    await grant({ userId: a.id, programId: elsewhere.id });
    void s;

    expect(
      await canManageStudent(a, {
        enrollments: [{ programId: mine.id }, { programId: theirs.id }],
      })
    ).toBe(false);
  });

  it("gives a platform admin every program the student is in", async () => {
    const { mine, theirs } = await twoPrograms();
    const p = await platformAdmin();

    expect(
      await studentScope(p, {
        enrollments: [{ programId: mine.id }, { programId: theirs.id }],
      })
    ).toEqual([mine.id, theirs.id]);
  });
});

describe("a mentor's reach across a student's programs", () => {
  it("reaches a student through the one program they share", async () => {
    const { mine, s } = await twoPrograms();
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: mine.id });

    expect(await mentorReaches(m, s)).toBe(true);
  });

  it("does not reach an unassigned pool held in a program they don't work in", async () => {
    const { theirs, s } = await twoPrograms();
    const m = await mentor();
    // Paired nowhere the student is, and the pool is in the program they are
    // not in — the leg that used to be "any pool of any student in reach".
    const elsewhere = await program("Elsewhere");
    await pairing({ mentorId: m.id, programId: elsewhere.id });
    await allocation({
      studentId: s.id,
      programId: theirs.id,
      mentorId: null,
      minutes: 300,
    });

    expect(await mentorReaches(m, s)).toBe(false);
  });

  it("gives the caseload one row per program, each with its own balance", async () => {
    const { mine, theirs, s } = await twoPrograms();
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: mine.id });
    await pairing({ mentorId: m.id, programId: theirs.id });
    await allocation({ studentId: s.id, programId: mine.id, mentorId: m.id, minutes: 600 });
    await allocation({ studentId: s.id, programId: theirs.id, mentorId: m.id, minutes: 300 });
    await session({ studentId: s.id, programId: mine.id, mentorId: m.id, minutes: 90 });

    const caseload = await mentorCaseload(m.id);
    const rows = caseload.students.filter((r) => r.profile.id === s.id);
    expect(rows).toHaveLength(2);
    const byProgram = new Map(rows.map((r) => [r.program.id, r]));
    expect(byProgram.get(mine.id)?.remaining).toBe(510);
    expect(byProgram.get(theirs.id)?.remaining).toBe(300);
  });
});
