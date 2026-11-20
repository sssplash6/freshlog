import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { grant, mentor, pairing, platformAdmin, program, student } from "@/test/db";

/**
 * When a written rating is marked as named to the mentor it is about. The
 * mark is what later shows that mentor the student's name, so it is made only
 * when BOTH hold: the form said so about this mentor before the student sent
 * it, and the mentor does administer one of the student's programs.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { submitMentorFeedback } = await import("@/lib/actions/feedback");

/** A student of one program and a mentor paired with it. */
async function scene() {
  const p = await program("Global Admissions");
  const s = await student({ programId: p.id, name: "Aziz Tursunov" });
  const m = await mentor("Valera Arakelyan");
  await pairing({ mentorId: m.id, programId: p.id });
  actor.value = { id: s.userId };
  return { p, s, m };
}

/** Send a rating of `mentorId`, from a form that warned about `toldNamed`. */
async function send(mentorId: string, toldNamed?: string) {
  const form = new FormData();
  form.set("mentorId", mentorId);
  form.set("rating", "2");
  form.set("comment", "Late twice.");
  if (toldNamed !== undefined) form.set("toldNamed", toldNamed);
  expect(await submitMentorFeedback(null, form)).toMatchObject({ ok: true });
  return prisma.mentorFeedback.findFirstOrThrow({ where: { mentorId }, orderBy: { createdAt: "desc" } });
}

beforeEach(() => {
  actor.value = null;
});

describe("submitMentorFeedback: namedToMentor", () => {
  it("marks a rating of a mentor who administers the student's program, when the form said so", async () => {
    const { p, m } = await scene();
    await grant({ userId: m.id, programId: p.id });
    expect((await send(m.id, m.id)).namedToMentor).toBe(true);
  });

  it("marks one of a platform admin who mentors, when the form said so", async () => {
    const { p, s } = await scene();
    const founder = await platformAdmin("Founder");
    await pairing({ mentorId: founder.id, programId: p.id });
    actor.value = { id: s.userId };
    expect((await send(founder.id, founder.id)).namedToMentor).toBe(true);
  });

  it("marks nothing when the form did not say so, whoever the mentor is", async () => {
    const { p, m } = await scene();
    await grant({ userId: m.id, programId: p.id });
    expect((await send(m.id)).namedToMentor).toBe(false);
    expect((await send(m.id, "")).namedToMentor).toBe(false);
  });

  it("marks nothing when the form warned about somebody else", async () => {
    const { p, m } = await scene();
    await grant({ userId: m.id, programId: p.id });
    const other = await mentor("Other Mentor");
    expect((await send(m.id, other.id)).namedToMentor).toBe(false);
  });

  it("marks nothing for a mentor who administers no program of the student's, whatever the form sent", async () => {
    const { m } = await scene();
    const elsewhere = await program("Imkon");
    await grant({ userId: m.id, programId: elsewhere.id });
    expect((await send(m.id, m.id)).namedToMentor).toBe(false);
  });

  it("marks nothing for a leader, whose grant only reads", async () => {
    const { p, m } = await scene();
    await grant({ userId: m.id, programId: p.id, role: "LEADER" });
    expect((await send(m.id, m.id)).namedToMentor).toBe(false);
  });
});
