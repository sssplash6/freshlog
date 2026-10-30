import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, assignment, grant, mentor, pairing, program, student } from "@/test/db";

/**
 * The agenda item's edit form saves itself as it is edited, so whatever it
 * posts it posts again and again while it stays open. These pin that a save
 * writes only what the person changed: the progress has its own control and
 * the form posts none, and the mentor the form opened on is not written back
 * over one somebody else picked meanwhile.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { setAssignmentProgress, updateAssignment } = await import("@/lib/actions/assignments");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const stored = (id: string) => prisma.assignment.findUniqueOrThrow({ where: { id } });

async function setUp() {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id });
  const [akmal, umid] = await Promise.all([mentor("Akmal Karimov"), mentor("Umid Rashidov")]);
  await pairing({ mentorId: akmal.id, programId: p.id });
  await pairing({ mentorId: umid.id, programId: p.id });
  const boss = await admin("Nodira Aliyeva");
  await grant({ userId: boss.id, programId: p.id });
  const a = await assignment({ studentId: st.id, programId: p.id, mentorId: akmal.id, purpose: "Personal statement" });
  actor.value = boss;
  return { a, akmal, umid };
}

/** What the edit form posts: every field it shows, as it shows them. */
const edit = (id: string, fields: Record<string, string>) =>
  form({ assignmentId: id, purpose: "", purposeCustom: "Personal statement", minuteLimit: "", dueOn: "", dueNote: "", note: "", ...fields });

describe("editing an agenda item", () => {
  it("keeps a progress somebody pinned while the form was open", async () => {
    const { a, akmal } = await setUp();
    expect((await setAssignmentProgress(null, form({ assignmentId: a.id, progress: "DONE" })))?.ok).toBe(true);

    const res = await updateAssignment(
      null,
      edit(a.id, { mentorId: akmal.id, openedMentorId: akmal.id, note: "Second draft in" })
    );

    expect(res?.ok).toBe(true);
    const row = await stored(a.id);
    expect([row.progress, row.progressManual, row.note]).toEqual(["DONE", true, "Second draft in"]);
  });

  it("does not hand back a mentor somebody moved it from while the form was open", async () => {
    const { a, akmal, umid } = await setUp();
    // Another admin hands it to Umid; this form opened on Akmal.
    await prisma.assignment.update({ where: { id: a.id }, data: { mentorId: umid.id } });

    const res = await updateAssignment(
      null,
      edit(a.id, { mentorId: akmal.id, openedMentorId: akmal.id, note: "Second draft in" })
    );

    expect(res?.ok).toBe(true);
    const row = await stored(a.id);
    expect([row.mentorId, row.note]).toEqual([umid.id, "Second draft in"]);
  });

  it("lets the item's own mentor correct it, and keeps them on it", async () => {
    const { a, akmal } = await setUp();
    actor.value = akmal;

    // Their form has no mentor select, so it posts none.
    const res = await updateAssignment(null, edit(a.id, { openedMentorId: akmal.id, note: "Second draft in" }));

    expect(res?.ok).toBe(true);
    const row = await stored(a.id);
    expect([row.mentorId, row.note]).toEqual([akmal.id, "Second draft in"]);
  });

  it("refuses the item's own mentor moving it to somebody else, or off everybody", async () => {
    const { a, akmal, umid } = await setUp();
    actor.value = akmal;
    const refusal = { ok: false, error: "Only an admin of this program can change an agenda item's mentor." };

    expect(await updateAssignment(null, edit(a.id, { mentorId: "", openedMentorId: akmal.id }))).toEqual(refusal);
    expect(await updateAssignment(null, edit(a.id, { mentorId: umid.id, openedMentorId: akmal.id }))).toEqual(refusal);
    expect((await stored(a.id)).mentorId).toBe(akmal.id);
  });

  it("writes a mentor the person picked", async () => {
    const { a, akmal, umid } = await setUp();

    const res = await updateAssignment(null, edit(a.id, { mentorId: umid.id, openedMentorId: akmal.id }));

    expect(res?.ok).toBe(true);
    expect((await stored(a.id)).mentorId).toBe(umid.id);
  });
});
