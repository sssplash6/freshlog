import { describe, expect, it } from "vitest";

import { mentorProgramRows } from "@/app/programs/mentor-programs";

/**
 * The mentor's own figures, per program. Three rules worth stating, and the
 * third is the one that would be wrong quietly: hours on a passed deadline are
 * forfeited, so they cannot be reported as time this mentor still holds.
 */
const masters = { id: "p1", name: "Master's Program" };
const admissions = { id: "p2", name: "Global Admissions" };

const held = (opts: {
  student: string;
  program: { id: string; name: string };
  completed?: number;
  remaining?: number;
  expired?: boolean;
}) => ({
  profile: { id: opts.student },
  program: opts.program,
  completed: opts.completed ?? 0,
  remaining: opts.remaining ?? 0,
  expired: opts.expired ?? false,
});

describe("mentorProgramRows", () => {
  it("lists a program they are paired with before anyone is allocated", () => {
    const rows = mentorProgramRows([{ program: masters, cohort: null }], []);

    expect(rows).toEqual([
      {
        id: "p1",
        name: "Master's Program",
        cohort: null,
        students: 0,
        completed: 0,
        remaining: 0,
      },
    ]);
  });

  it("names the cohort when the pairing names one", () => {
    const rows = mentorProgramRows(
      [{ program: masters, cohort: { name: "Autumn" } }],
      []
    );

    expect(rows[0].cohort).toBe("Autumn");
  });

  it("counts each student once and adds their figures up", () => {
    const rows = mentorProgramRows(
      [{ program: masters, cohort: null }],
      [
        held({ student: "s1", program: masters, completed: 60, remaining: 120 }),
        held({ student: "s2", program: masters, completed: 30, remaining: 90 }),
      ]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ students: 2, completed: 90, remaining: 210 });
  });

  /** A grant, a task moved over, or a session already logged. */
  it("includes a program they reach without a pairing in it", () => {
    const rows = mentorProgramRows(
      [{ program: masters, cohort: null }],
      [held({ student: "s1", program: admissions, completed: 45, remaining: 15 })]
    );

    expect(rows.map((r) => r.name)).toEqual([
      "Global Admissions",
      "Master's Program",
    ]);
    expect(rows[0]).toMatchObject({ students: 1, completed: 45, remaining: 15 });
  });

  it("forfeits the unused hours on an expired allocation", () => {
    const rows = mentorProgramRows(
      [{ program: masters, cohort: null }],
      [held({ student: "s1", program: masters, remaining: 300, expired: true })]
    );

    expect(rows[0].remaining).toBe(0);
  });

  it("keeps an overdraw that outlived its deadline", () => {
    const rows = mentorProgramRows(
      [{ program: masters, cohort: null }],
      [held({ student: "s1", program: masters, remaining: -45, expired: true })]
    );

    expect(rows[0].remaining).toBe(-45);
  });

  it("reads alphabetically, whatever order the rows arrived in", () => {
    const rows = mentorProgramRows(
      [
        { program: masters, cohort: null },
        { program: admissions, cohort: null },
      ],
      []
    );

    expect(rows.map((r) => r.name)).toEqual([
      "Global Admissions",
      "Master's Program",
    ]);
  });
});
