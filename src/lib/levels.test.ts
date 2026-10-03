import { describe, expect, it } from "vitest";

import { mentorReaches } from "@/lib/authz";
import { enrollmentLabel } from "@/lib/enrollments";
import { prisma } from "@/lib/prisma";
import { assignmentsForStudentWhere, mentorReachWhere } from "@/lib/queries";
import { grantStandardHours } from "@/lib/standard-hours";
import {
  admin,
  allocation,
  cohort,
  level,
  mentor,
  pairing,
  program,
  student,
} from "@/test/db";

/**
 * A level inside a program — Emerging under Research, priced at two hours
 * where Advanced prices fifteen. Levels were added so one program can hold
 * the three research tracks and still grant each its own standard; these are
 * the rules that have to hold for that to mean anything:
 *
 *   - a level's standard pair is the grant its joiners get
 *   - a level that sets no pair (or half a pair) inherits the program's
 *   - a mentor paired to a level reaches the students of every cohort under
 *     it, and a program-wide pairing reaches every level
 *   - two levels may hold same-named cohorts — "Fall 2026" is a fact about a
 *     level, not the program
 */

describe("the level's standard is the grant", () => {
  const today = "2026-09-03";

  it("grants the level's pair, not the program's", async () => {
    const research = await program("Research");
    await prisma.program.update({
      where: { id: research.id },
      data: { standardMinutes: 60, standardDays: 30 },
    });
    const advanced = await level({
      programId: research.id,
      name: "Advanced",
      standardMinutes: 900,
      standardDays: 90,
    });
    const s = await student({ programId: research.id, levelId: advanced.id });
    const by = await admin();

    const made = await prisma.$transaction((tx) =>
      grantStandardHours(tx, {
        studentId: s.id,
        programId: research.id,
        levelId: advanced.id,
        actorId: by.id,
        today,
      })
    );

    // 90 days after 2026-09-03, not the program's 30.
    expect(made).toEqual({
      minutes: 900,
      deadline: new Date("2026-12-02T00:00:00.000Z"),
    });
  });

  it("inherits the program's pair when the level sets none", async () => {
    const research = await program("Research");
    await prisma.program.update({
      where: { id: research.id },
      data: { standardMinutes: 600, standardDays: 90 },
    });
    const unnamed = await level({ programId: research.id, name: "Unpriced" });
    const s = await student({ programId: research.id, levelId: unnamed.id });
    const by = await admin();

    const made = await prisma.$transaction((tx) =>
      grantStandardHours(tx, {
        studentId: s.id,
        programId: research.id,
        levelId: unnamed.id,
        actorId: by.id,
        today,
      })
    );

    expect(made?.minutes).toBe(600);
  });

  it("a half-set level is no standard at all — the program's pair applies", async () => {
    const research = await program("Research");
    await prisma.program.update({
      where: { id: research.id },
      data: { standardMinutes: 600, standardDays: 90 },
    });
    // Minutes with no days must not end up spent inside the program's window.
    const half = await level({
      programId: research.id,
      name: "Half",
      standardMinutes: 120,
      standardDays: null,
    });
    const s = await student({ programId: research.id, levelId: half.id });
    const by = await admin();

    const made = await prisma.$transaction((tx) =>
      grantStandardHours(tx, {
        studentId: s.id,
        programId: research.id,
        levelId: half.id,
        actorId: by.id,
        today,
      })
    );

    expect(made?.minutes).toBe(600);
  });
});

describe("naming a level", () => {
  it("labels a level the way it labels a cohort", () => {
    expect(
      enrollmentLabel({
        programId: "p",
        levelId: "l",
        cohortId: null,
        program: { name: "Research" },
        level: { name: "Emerging" },
        cohort: null,
      })
    ).toBe("Research / Emerging");
    expect(
      enrollmentLabel({
        programId: "p",
        levelId: "l",
        cohortId: "c",
        program: { name: "Research" },
        level: { name: "Advanced" },
        cohort: { name: "Fall 2026" },
      })
    ).toBe("Research / Advanced / Fall 2026");
  });
});

describe("same-named cohorts under different levels", () => {
  it("holds a Fall 2026 under each of two levels", async () => {
    const research = await program("Research");
    const emerging = await level({ programId: research.id, name: "Emerging" });
    const advanced = await level({ programId: research.id, name: "Advanced" });

    const a = await cohort({ programId: research.id, levelId: emerging.id, name: "Fall 2026" });
    const b = await cohort({ programId: research.id, levelId: advanced.id, name: "Fall 2026" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("a mentor's reach across a program's levels", () => {
  it("a program-wide pairing reaches every level — the merge's whole point", async () => {
    const research = await program("Research");
    const emerging = await level({ programId: research.id, name: "Emerging" });
    const frontiers = await level({ programId: research.id, name: "Frontiers" });
    const a = await student({ programId: research.id, levelId: emerging.id });
    const b = await student({ programId: research.id, levelId: frontiers.id });
    const levelless = await student({ programId: research.id });

    const m = await mentor();
    await pairing({ mentorId: m.id, programId: research.id });

    expect(await mentorReaches(m, a)).toBe(true);
    expect(await mentorReaches(m, b)).toBe(true);
    expect(await mentorReaches(m, levelless)).toBe(true);
  });

  it("even a level-scoped pairing logs with anyone in the program", async () => {
    // Logging reach is program-wide on purpose — a mentor who works in a
    // program may record a meeting with any of its students. The level only
    // narrows which pool they may claim, tested below.
    const research = await program("Research");
    const emerging = await level({ programId: research.id, name: "Emerging" });
    const advanced = await level({ programId: research.id, name: "Advanced" });
    const outside = await student({ programId: research.id, levelId: advanced.id });

    const m = await mentor();
    await pairing({ mentorId: m.id, programId: research.id, levelId: emerging.id });

    expect(await mentorReaches(m, outside)).toBe(true);
  });

  it("a student sees the mentors paired to their level, cohort or program", async () => {
    const research = await program("Research");
    const emerging = await level({ programId: research.id, name: "Emerging" });
    const advanced = await level({ programId: research.id, name: "Advanced" });
    const fall = await cohort({ programId: research.id, levelId: emerging.id, name: "Fall" });
    const spring = await cohort({ programId: research.id, levelId: emerging.id, name: "Spring" });
    await student({ programId: research.id, levelId: emerging.id, cohortId: fall.id });

    const [whole, lvl, own, otherLevel, otherCohort, elsewhere] = await Promise.all([
      mentor("Program-wide"), mentor("Emerging"), mentor("Fall"),
      mentor("Advanced-only"), mentor("Spring-only"), mentor("Elsewhere"),
    ]);
    await pairing({ mentorId: whole.id, programId: research.id });
    await pairing({ mentorId: lvl.id, programId: research.id, levelId: emerging.id });
    await pairing({ mentorId: own.id, programId: research.id, cohortId: fall.id });
    await pairing({ mentorId: otherLevel.id, programId: research.id, levelId: advanced.id });
    await pairing({ mentorId: otherCohort.id, programId: research.id, cohortId: spring.id });
    await pairing({ mentorId: elsewhere.id, programId: (await program("Elsewhere")).id });

    const visible = await prisma.mentorAssignment.findMany({
      where: assignmentsForStudentWhere({
        enrollments: [{ programId: research.id, levelId: emerging.id, cohortId: fall.id }],
      }),
      select: { mentorId: true },
    });
    expect(new Set(visible.map((v) => v.mentorId))).toEqual(
      new Set([whole.id, lvl.id, own.id])
    );
  });

  it("a level pairing claims the unassigned pool only inside its level", async () => {
    const research = await program("Research");
    const emerging = await level({ programId: research.id, name: "Emerging" });
    const advanced = await level({ programId: research.id, name: "Advanced" });
    const mine = await student({ programId: research.id, levelId: emerging.id });
    const theirs = await student({ programId: research.id, levelId: advanced.id });
    await allocation({ studentId: mine.id, programId: research.id, mentorId: null, minutes: 120 });
    await allocation({ studentId: theirs.id, programId: research.id, mentorId: null, minutes: 120 });

    const m = await mentor();
    const p = await pairing({ mentorId: m.id, programId: research.id, levelId: emerging.id });

    // The pool leg, isolated from the loggable fifth leg: the level narrows
    // whose unassigned time this mentor may claim.
    const where = mentorReachWhere(m.id, {
      pairings: [{ programId: p.programId, levelId: p.levelId, cohortId: p.cohortId }],
    });
    const reached = await prisma.studentProfile.findMany({ where, select: { id: true } });
    expect(reached.map((r) => r.id).sort()).toEqual([mine.id]);
  });
});
