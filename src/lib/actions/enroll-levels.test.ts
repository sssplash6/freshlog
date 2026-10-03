import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, cohort, grant, level, program, student } from "@/test/db";

/**
 * Enrolling into a leveled program is three answers — program, level, cohort —
 * and `resolveEnrollment` is where a form that skipped one is turned back.
 * These run `enrollStudent` itself rather than the resolver, because the rule
 * that matters is the one the action enforces.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { enrollStudent } = await import("@/lib/actions/students");

type ActionResult = Awaited<ReturnType<typeof enrollStudent>>;

/** Narrow the state to its failure half, with the error in hand. */
function failed(res: ActionResult): asserts res is { ok: false; error: string } {
  if (!res || res.ok) {
    throw new Error(`Expected a refusal, got ${JSON.stringify(res)}`);
  }
}

/** Narrow the state to success, with the message in hand. */
function passed(res: ActionResult): asserts res is { ok: true; message?: string } {
  if (!res || !res.ok) {
    throw new Error(`Expected success, got ${JSON.stringify(res)}`);
  }
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

async function researchAdmin() {
  const research = await program("Research");
  const emerging = await level({ programId: research.id, name: "Emerging" });
  const advanced = await level({ programId: research.id, name: "Advanced" });
  const fall = await cohort({ programId: research.id, levelId: emerging.id, name: "Fall 2026" });
  // Advanced needs a cohort of its own for the cross-level refusal to bite.
  const advFall = await cohort({ programId: research.id, levelId: advanced.id, name: "Fall 2026" });
  const boss = await admin("Boss");
  await grant({ userId: boss.id, programId: research.id });
  actor.value = boss;
  const s = await student({ programId: (await program("Elsewhere")).id });
  return { research, emerging, advanced, fall, advFall, s };
}

describe("enrolling into a leveled program", () => {
  it("refuses a program pick alone — the level is required", async () => {
    const { research, s } = await researchAdmin();

    const res = await enrollStudent(null, form({ studentProfileId: s.id, programId: research.id }));
    failed(res);
    expect(res.error).toBe("Pick a level in Research.");
  });

  it("refuses a level whose cohorts exist without the cohort", async () => {
    const { research, emerging, s } = await researchAdmin();

    const res = await enrollStudent(
      null,
      form({ studentProfileId: s.id, programId: research.id, levelId: emerging.id })
    );
    failed(res);
    expect(res.error).toBe("Pick a cohort in Emerging.");
  });

  it("refuses a cohort that belongs to another level of the same program", async () => {
    const { research, advanced, fall, s } = await researchAdmin();

    const res = await enrollStudent(
      null,
      form({
        studentProfileId: s.id,
        programId: research.id,
        levelId: advanced.id,
        cohortId: fall.id,
      })
    );
    failed(res);
    expect(res.error).toBe("Pick a cohort in Advanced.");
  });

  it("enrolls with the level and cohort the form named", async () => {
    const { research, emerging, fall, s } = await researchAdmin();

    const res = await enrollStudent(
      null,
      form({
        studentProfileId: s.id,
        programId: research.id,
        levelId: emerging.id,
        cohortId: fall.id,
      })
    );
    passed(res);
    expect(res.message).toContain("Research / Emerging / Fall 2026");

    const e = await prisma.studentEnrollment.findFirst({
      where: { studentId: s.id, programId: research.id },
    });
    expect(e?.levelId).toBe(emerging.id);
    expect(e?.cohortId).toBe(fall.id);
  });

  it("grants the level's standard, not the program's", async () => {
    const { research, emerging, fall, s } = await researchAdmin();
    await prisma.program.update({
      where: { id: research.id },
      data: { standardMinutes: 60, standardDays: 30 },
    });
    await prisma.programLevel.update({
      where: { id: emerging.id },
      data: { standardMinutes: 120, standardDays: 60 },
    });

    const res = await enrollStudent(
      null,
      form({
        studentProfileId: s.id,
        programId: research.id,
        levelId: emerging.id,
        cohortId: fall.id,
      })
    );
    passed(res);
    expect(res.message).toContain("2h");

    const grant_ = await prisma.hourAllocation.findFirst({
      where: { studentId: s.id, programId: research.id },
    });
    expect(grant_?.minutes).toBe(120);
  });

  it("a flat program with cohorts still asks for one, the old way", async () => {
    const flat = await program("Flat");
    const spring = await cohort({ programId: flat.id, name: "Spring 25" });
    const boss = await admin("Boss");
    await grant({ userId: boss.id, programId: flat.id });
    actor.value = boss;
    const s = await student({ programId: (await program("Elsewhere2")).id });

    const noCohort = await enrollStudent(
      null,
      form({ studentProfileId: s.id, programId: flat.id })
    );
    failed(noCohort);
    expect(noCohort.error).toBe("Pick a cohort in Flat.");

    const ok = await enrollStudent(
      null,
      form({ studentProfileId: s.id, programId: flat.id, cohortId: spring.id })
    );
    passed(ok);
  });
});
