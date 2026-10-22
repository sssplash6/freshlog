import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { passCookieName, readPass, signPass } from "@/lib/partner-feedback";
import { mentor, partner, partnerEmail, partnerMentor } from "@/test/db";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string | { name: string }) =>
      void jar.delete(typeof k === "string" ? k : k.name),
  }),
}));

const { checkPartnerEmail, submitPartnerFeedback, forgetPartnerEmail } = await import(
  "@/lib/actions/partner-feedback"
);

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const NOT_OPEN = { ok: false, error: "This form isn't open." };
const PASS_AGAIN = { ok: false, error: "Enter your email again to continue.", field: "pass" };
const sessionForm = () =>
  form({ sessionNumber: "1", name: "A", rating: "5", comment: "Ok" });

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-for-partner-passes");
  jar.clear();
});

/** A partner with one listed student who already holds a live pass. */
async function passed(email = "a@x.uz") {
  const p = await partner({ slug: "khana", name: "Khana" });
  await partnerEmail(p.id, email);
  jar.set(passCookieName(p.slug), signPass(p.slug, email, new Date()).value);
  return p;
}

const mentorForm = (mentorId: string) =>
  form({ mentorId, rating: "4", comment: "  Clear and patient.  " });

describe("checkPartnerEmail", () => {
  it("passes a listed email, however it was typed, and sets the cookie", async () => {
    const p = await partner({ slug: "khana", name: "Khana" });
    await partnerEmail(p.id, "a@x.uz");
    const result = await checkPartnerEmail("khana", null, form({ email: " A@X.uz " }));
    expect(result).toEqual({ ok: true });
    expect(readPass(p.slug, jar.get("pf_khana"), new Date())).toBe("a@x.uz");
  });

  it("refuses an unlisted email by name and sets nothing", async () => {
    const p = await partner({ slug: "khana", name: "Khana" });
    await partnerEmail(p.id, "a@x.uz");
    const result = await checkPartnerEmail("khana", null, form({ email: "b@x.uz" }));
    expect(result).toMatchObject({
      ok: false,
      error:
        "This email isn't on the list for Khana. Check the address, or ask your coordinator to add it.",
      field: "email",
    });
    expect(jar.size).toBe(0);
  });

  it("answers an inactive partner and an unknown slug the same way", async () => {
    await partner({ slug: "off", active: false });
    expect(await checkPartnerEmail("off", null, form({ email: "a@x.uz" }))).toMatchObject(NOT_OPEN);
    expect(await checkPartnerEmail("nope", null, form({ email: "a@x.uz" }))).toMatchObject(NOT_OPEN);
    expect(jar.size).toBe(0);
  });

  it("finds the partner by a normalized slug and signs with the stored one", async () => {
    const p = await partner({ slug: "khana" });
    await partnerEmail(p.id, "a@x.uz");
    expect(await checkPartnerEmail(" Khana ", null, form({ email: "a@x.uz" }))).toEqual({ ok: true });
    expect(readPass("khana", jar.get("pf_khana"), new Date())).toBe("a@x.uz");
  });
});

describe("submitPartnerFeedback", () => {
  it("stores a mentor rating", async () => {
    const p = await passed();
    const m = await mentor();
    await partnerMentor(p.id, m.id);
    const result = await submitPartnerFeedback("khana", "MENTOR", null, mentorForm(m.id));
    expect(result).toEqual({ ok: true, message: "Thanks — your feedback was sent." });
    const rows = await prisma.partnerFeedback.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      partnerId: p.id,
      kind: "MENTOR",
      studentEmail: "a@x.uz",
      mentorId: m.id,
      rating: 4,
      comment: "Clear and patient.",
      sessionNumber: null,
      name: null,
    });
  });

  it("stores a session rating", async () => {
    const p = await passed();
    const result = await submitPartnerFeedback(
      "khana",
      "SESSION",
      null,
      form({ sessionNumber: "3", name: "Aziza", rating: "5", comment: "Great." })
    );
    expect(result).toMatchObject({ ok: true });
    const rows = await prisma.partnerFeedback.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      partnerId: p.id,
      kind: "SESSION",
      sessionNumber: 3,
      name: "Aziza",
      mentorId: null,
    });
  });

  it("refuses a mentor the partner does not list, and keeps the typed values", async () => {
    await passed();
    const other = await mentor();
    const result = await submitPartnerFeedback("khana", "MENTOR", null, mentorForm(other.id));
    expect(result).toMatchObject({
      ok: false,
      error: "Pick one of the listed mentors.",
      field: "mentorId",
      values: { rating: "4" },
    });
    expect(await prisma.partnerFeedback.count()).toBe(0);
    expect(jar.has("pf_khana")).toBe(true);
  });

  it("refuses a mentor unticked after the page loaded", async () => {
    const p = await passed();
    const m = await mentor();
    await partnerMentor(p.id, m.id);
    await prisma.partnerMentor.deleteMany();
    const result = await submitPartnerFeedback("khana", "MENTOR", null, mentorForm(m.id));
    expect(result).toMatchObject({ ok: false, field: "mentorId" });
    expect(await prisma.partnerFeedback.count()).toBe(0);
  });

  it("refuses a mentor still ticked but no longer active", async () => {
    const p = await passed();
    const m = await mentor();
    await partnerMentor(p.id, m.id);
    await prisma.user.update({ where: { id: m.id }, data: { status: "UNASSIGNED" } });
    const result = await submitPartnerFeedback("khana", "MENTOR", null, mentorForm(m.id));
    expect(result).toMatchObject({ ok: false, error: "Pick one of the listed mentors.", field: "mentorId" });
    expect(await prisma.partnerFeedback.count()).toBe(0);
  });

  it("refuses without a cookie", async () => {
    await passed();
    jar.clear();
    const m = await mentor();
    expect(await submitPartnerFeedback("khana", "MENTOR", null, mentorForm(m.id))).toMatchObject(
      PASS_AGAIN
    );
    expect(await prisma.partnerFeedback.count()).toBe(0);
  });

  it("refuses a tampered cookie and deletes it", async () => {
    await passed();
    jar.set("pf_khana", jar.get("pf_khana") + "x");
    const m = await mentor();
    expect(await submitPartnerFeedback("khana", "MENTOR", null, mentorForm(m.id))).toMatchObject(
      PASS_AGAIN
    );
    expect(jar.has("pf_khana")).toBe(false);
    expect(await prisma.partnerFeedback.count()).toBe(0);
  });

  it("refuses another partner's cookie copied in", async () => {
    await passed();
    const other = await partner({ slug: "other", name: "Other" });
    await partnerEmail(other.id, "a@x.uz");
    jar.set("pf_other", signPass("khana", "a@x.uz", new Date()).value);
    const result = await submitPartnerFeedback("other", "SESSION", null, sessionForm());
    expect(result).toMatchObject(PASS_AGAIN);
    expect(jar.has("pf_other")).toBe(false);
    expect(await prisma.partnerFeedback.count()).toBe(0);
  });

  it("refuses when the email left the list after the pass was issued", async () => {
    await passed();
    await prisma.partnerStudent.deleteMany();
    const result = await submitPartnerFeedback("khana", "SESSION", null, sessionForm());
    expect(result).toMatchObject(PASS_AGAIN);
    expect(jar.has("pf_khana")).toBe(false);
    expect(await prisma.partnerFeedback.count()).toBe(0);
  });

  it("refuses when the partner was switched off after the pass was issued", async () => {
    const p = await passed();
    await prisma.feedbackPartner.update({ where: { id: p.id }, data: { active: false } });
    const result = await submitPartnerFeedback("khana", "SESSION", null, sessionForm());
    expect(result).toMatchObject(NOT_OPEN);
    expect(await prisma.partnerFeedback.count()).toBe(0);
  });

  it("returns a field error for a malformed form", async () => {
    await passed();
    const result = await submitPartnerFeedback(
      "khana",
      "SESSION",
      null,
      form({ sessionNumber: "0", name: "A", rating: "5", comment: "Ok" })
    );
    expect(result).toMatchObject({ ok: false, field: "sessionNumber", values: { name: "A" } });
  });
});

describe("forgetPartnerEmail", () => {
  it("deletes the cookie", async () => {
    await passed();
    await forgetPartnerEmail("khana");
    expect(jar.has("pf_khana")).toBe(false);
  });
});

describe("submitPartnerFeedback with a kind the browser made up", () => {
  it("refuses it and writes nothing", async () => {
    await passed();
    const result = await submitPartnerFeedback("khana", "X" as "MENTOR", null, sessionForm());
    expect(result).toEqual(NOT_OPEN);
    expect(await prisma.partnerFeedback.count()).toBe(0);
  });
});

describe("deleting a ticked mentor", () => {
  it("succeeds and removes the tick, keeping the feedback it rated", async () => {
    const p = await passed();
    const m = await mentor();
    await partnerMentor(p.id, m.id);
    await submitPartnerFeedback("khana", "MENTOR", null, mentorForm(m.id));

    await prisma.user.delete({ where: { id: m.id } });

    expect(await prisma.partnerMentor.count({ where: { partnerId: p.id } })).toBe(0);
    expect(await prisma.partnerFeedback.count()).toBe(1);
  });
});
