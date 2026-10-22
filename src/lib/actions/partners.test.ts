import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, mentor, partner, partnerEmail, partnerMentor, platformAdmin, student } from "@/test/db";

const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const {
  createPartner,
  updatePartner,
  addPartnerEmails,
  removePartnerEmail,
  setPartnerMentors,
} = await import("@/lib/actions/partners");

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const one of Array.isArray(v) ? v : [v]) data.append(k, one);
  }
  return data;
}

/** A created partner ends in a redirect; its digest names the target. */
async function create(fields: Record<string, string>) {
  try {
    return { state: await createPartner(null, form(fields)), to: null as string | null };
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? "");
    const to = /^NEXT_REDIRECT;[^;]*;([^;]+);/.exec(digest)?.[1];
    if (!to) throw error;
    return { state: null, to };
  }
}

const NOT_ALLOWED = { ok: false, error: "Not allowed." };

describe("refusals", () => {
  it("answers 'Not allowed.' to a plain admin and to nobody, and writes nothing", async () => {
    const p = await partner();
    const m = await mentor();
    const email = await partnerEmail(p.id, "a@x.uz");

    for (const who of [await admin(), null]) {
      actor.value = who;
      expect((await create({ name: "Cana", slug: "cana-new" })).state).toEqual(NOT_ALLOWED);
      expect(await updatePartner(p.id, null, form({ name: "Changed" }))).toEqual(NOT_ALLOWED);
      expect(await addPartnerEmails(p.id, null, form({ emails: "z@x.uz" }))).toEqual(NOT_ALLOWED);
      expect(await removePartnerEmail(p.id, email.id)).toEqual(NOT_ALLOWED);
      expect(await setPartnerMentors(p.id, null, form({ mentorId: m.id }))).toEqual(NOT_ALLOWED);
    }

    expect(await prisma.feedbackPartner.count()).toBe(1);
    expect((await prisma.feedbackPartner.findUniqueOrThrow({ where: { id: p.id } })).name).toBe("Cana");
    expect(await prisma.partnerStudent.count()).toBe(1);
    expect(await prisma.partnerMentor.count()).toBe(0);
  });

  it("answers an unknown partner the same way", async () => {
    actor.value = await platformAdmin();
    expect(await updatePartner("nope", null, form({ name: "X" }))).toEqual(NOT_ALLOWED);
    expect(await addPartnerEmails("nope", null, form({ emails: "a@x.uz" }))).toEqual(NOT_ALLOWED);
    expect(await removePartnerEmail("nope", "nope")).toEqual(NOT_ALLOWED);
    expect(await setPartnerMentors("nope", null, form({}))).toEqual(NOT_ALLOWED);
  });
});

describe("createPartner", () => {
  it("normalizes the slug, redirects to settings, and refuses a taken one", async () => {
    actor.value = await platformAdmin();

    const first = await create({ name: "  Cana  ", slug: " Cana " });
    expect(first.to).toBe("/partners/cana/settings");
    expect(await prisma.feedbackPartner.findUniqueOrThrow({ where: { slug: "cana" } })).toMatchObject({
      name: "Cana",
      active: true,
    });

    const again = await create({ name: "Cana", slug: "cana" });
    expect(again.state).toMatchObject({ ok: false, field: "slug", error: "That link is already used." });
    expect(await prisma.feedbackPartner.count()).toBe(1);
  });

  it("refuses a bad slug and a bad name", async () => {
    actor.value = await platformAdmin();
    expect((await create({ name: "Cana", slug: "a b" })).state).toMatchObject({
      field: "slug",
      error: "Use 2–40 lowercase letters, digits or dashes.",
    });
    expect((await create({ name: "  ", slug: "cana" })).state).toMatchObject({
      field: "name",
      error: "Enter a name.",
    });
    expect((await create({ name: "x".repeat(81), slug: "cana" })).state).toMatchObject({
      field: "name",
      error: "Keep it under 80 characters.",
    });
    expect(await prisma.feedbackPartner.count()).toBe(0);
  });
});

describe("updatePartner", () => {
  it("renames and switches off, and on again", async () => {
    actor.value = await platformAdmin();
    const p = await partner();
    expect(await updatePartner(p.id, null, form({ name: " Cana School " }))).toMatchObject({ ok: true });
    expect(await prisma.feedbackPartner.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({
      name: "Cana School",
      active: false,
    });
    await updatePartner(p.id, null, form({ name: "Cana School", active: "on" }));
    expect((await prisma.feedbackPartner.findUniqueOrThrow({ where: { id: p.id } })).active).toBe(true);
  });

  it("validates the name", async () => {
    actor.value = await platformAdmin();
    const p = await partner();
    expect(await updatePartner(p.id, null, form({ name: "" }))).toMatchObject({ field: "name" });
  });
});

describe("addPartnerEmails", () => {
  it("reports added, already listed and invalid exactly", async () => {
    actor.value = await platformAdmin();
    const p = await partner();
    await partnerEmail(p.id, "a@x.uz");

    const state = await addPartnerEmails(p.id, null, form({ emails: "A@x.uz\nb@x.uz, b@x.uz;bob@" }));
    expect(state).toEqual({ ok: true, message: "Added 1. 1 already listed. 1 not valid: bob@." });
    const rows = await prisma.partnerStudent.findMany({ where: { partnerId: p.id }, orderBy: { email: "asc" } });
    expect(rows.map((r) => r.email)).toEqual(["a@x.uz", "b@x.uz"]);
  });

  it("omits zero clauses and refuses an empty paste", async () => {
    actor.value = await platformAdmin();
    const p = await partner();
    expect(await addPartnerEmails(p.id, null, form({ emails: "c@x.uz" }))).toEqual({ ok: true, message: "Added 1." });
    expect(await addPartnerEmails(p.id, null, form({ emails: " \n " }))).toMatchObject({
      ok: false,
      field: "emails",
    });
  });

  it("lists only the first five invalid", async () => {
    actor.value = await platformAdmin();
    const p = await partner();
    const state = await addPartnerEmails(p.id, null, form({ emails: "a@,b@,c@,d@,e@,f@" }));
    expect(state).toEqual({ ok: true, message: "6 not valid: a@, b@, c@, d@, e@." });
    expect(await prisma.partnerStudent.count()).toBe(0);
  });
});

describe("removePartnerEmail", () => {
  it("removes its own row and refuses another partner's", async () => {
    actor.value = await platformAdmin();
    const p = await partner();
    const other = await partner();
    const mine = await partnerEmail(p.id, "a@x.uz");
    const theirs = await partnerEmail(other.id, "a@x.uz");

    expect(await removePartnerEmail(p.id, theirs.id)).toEqual(NOT_ALLOWED);
    expect(await prisma.partnerStudent.count()).toBe(2);

    expect(await removePartnerEmail(p.id, mine.id)).toMatchObject({ ok: true });
    expect(await prisma.partnerStudent.findMany()).toHaveLength(1);
  });
});

describe("setPartnerMentors", () => {
  it("keeps only people who can act as mentors, and an empty set clears", async () => {
    actor.value = await platformAdmin();
    const p = await partner();
    const m = await mentor();
    const s = await student();

    expect(
      await setPartnerMentors(p.id, null, form({ mentorId: [m.id, s.userId, "ghost"] }))
    ).toMatchObject({ ok: true });
    expect((await prisma.partnerMentor.findMany()).map((r) => r.mentorId)).toEqual([m.id]);

    expect(await setPartnerMentors(p.id, null, form({}))).toMatchObject({ ok: true });
    expect(await prisma.partnerMentor.count()).toBe(0);
  });

  it("replaces the set without touching another partner's", async () => {
    actor.value = await platformAdmin();
    const p = await partner();
    const other = await partner();
    const a = await mentor();
    const b = await mentor();
    await partnerMentor(p.id, a.id);
    await partnerMentor(other.id, a.id);

    await setPartnerMentors(p.id, null, form({ mentorId: b.id }));
    expect((await prisma.partnerMentor.findMany({ where: { partnerId: p.id } })).map((r) => r.mentorId)).toEqual([b.id]);
    expect(await prisma.partnerMentor.count({ where: { partnerId: other.id } })).toBe(1);
  });
});
