import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ROLES } from "@/lib/constants";
import type { HoursResponse, MentorsResponse } from "@/lib/payroll-api/contract";
import { prisma } from "@/lib/prisma";
import { mentor, platformAdmin, program, student } from "@/test/db";
import { programToday } from "@/lib/when";

import { GET as hoursGET } from "./hours/route";
import { GET as mentorsGET } from "./mentors/route";

/**
 * The payroll API against its contract. The first test is the one FreshWeek
 * relies on: seeded with exactly the scenario in `hours.sample.json` (and some
 * rows that must not appear), the hours route answers that file byte for byte
 * but for `generatedAt`. FreshWeek's own tests read the same file.
 */

const SECRET = "test-payroll-secret-0123456789";
const BASE = "https://www.freshlog.net/api/payroll/v1";
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

const sample = JSON.parse(
  readFileSync(join(process.cwd(), "src/lib/payroll-api/hours.sample.json"), "utf8")
) as HoursResponse;

function hours(query: string, auth: string | null = `Bearer ${SECRET}`) {
  const headers = new Headers();
  if (auth !== null) headers.set("authorization", auth);
  return hoursGET(new NextRequest(`${BASE}/hours${query}`, { headers }));
}

function mentors(auth: string | null = `Bearer ${SECRET}`) {
  const headers = new Headers();
  if (auth !== null) headers.set("authorization", auth);
  return mentorsGET(new Request(`${BASE}/mentors`, { headers }));
}

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.PAYROLL_API_SECRET;
  process.env.PAYROLL_API_SECRET = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.PAYROLL_API_SECRET;
  else process.env.PAYROLL_API_SECRET = saved;
});

/** The sample's world, plus distractors that must not come back. */
async function seedSample() {
  const boss = await platformAdmin();
  const m = await prisma.user.create({
    data: { email: "mentor@freshman.academy", name: "Test Mentor", role: ROLES.MENTOR },
  });
  const other = await mentor("Other Mentor");
  const sat = await program("SAT");
  const ga = await program("Global Admissions");
  const one = await student({ programId: sat.id, name: "Student One" });
  const two = await student({ programId: ga.id, name: "Student Two" });

  // The second rate is created after the first, as a real one would be.
  await prisma.mentorPayRate.create({
    data: {
      mentorId: m.id,
      centsPerHour: 2000,
      effectiveFrom: day("2026-12-01"),
      createdById: boss.id,
      createdAt: new Date("2026-11-25T10:00:00.000Z"),
    },
  });
  await prisma.mentorPayRate.create({
    data: {
      mentorId: m.id,
      centsPerHour: 2500,
      effectiveFrom: day("2026-12-15"),
      createdById: boss.id,
      createdAt: new Date("2026-12-14T10:00:00.000Z"),
    },
  });

  const base = { mentorId: m.id, status: "ACTIVE", attended: true, withinPlan: true };
  const rows = [
    { ...base, id: "s-dec02", studentId: one.id, programId: sat.id, date: day("2026-12-02"), createdAt: new Date("2026-12-02T12:00:00.000Z"), minutes: 60 },
    { ...base, id: "s-dec10", studentId: one.id, programId: sat.id, date: day("2026-12-10"), createdAt: new Date("2026-12-11T09:00:00.000Z"), minutes: 45, attended: false },
    { ...base, id: "s-dec16", studentId: two.id, programId: ga.id, date: day("2026-12-16"), createdAt: new Date("2026-12-16T15:00:00.000Z"), minutes: 90, withinPlan: false },
    { ...base, id: "s-dec20", studentId: two.id, programId: ga.id, date: day("2026-12-20"), createdAt: new Date("2026-12-27T08:00:00.000Z"), minutes: 25, studentAnswer: "DISPUTED", studentAnsweredAt: new Date("2026-12-27T09:00:00.000Z") },
    // Distractors.
    { ...base, id: "x-nov30", studentId: one.id, programId: sat.id, date: day("2026-11-30"), minutes: 60 },
    { ...base, id: "x-void", studentId: one.id, programId: sat.id, date: day("2026-12-05"), minutes: 60, status: "VOIDED" },
    { ...base, id: "x-resched", studentId: two.id, programId: ga.id, date: day("2026-12-06"), minutes: 60, status: "RESCHEDULED" },
    { ...base, id: "x-other", mentorId: other.id, studentId: one.id, programId: sat.id, date: day("2026-12-07"), minutes: 60 },
  ];
  for (const data of rows) await prisma.session.create({ data });
  return { m, other, boss };
}

describe("GET /api/payroll/v1/hours — the contract", () => {
  it("answers hours.sample.json exactly, but for generatedAt", async () => {
    await seedSample();
    const res = await hours("?email=mentor@freshman.academy");
    expect(res.status).toBe(200);
    const body = (await res.json()) as HoursResponse;
    expect(new Date(body.generatedAt).toISOString()).toBe(body.generatedAt);
    expect({ ...body, generatedAt: sample.generatedAt }).toEqual(sample);
    // Same keys in the same order, so the two serialise identically.
    expect(JSON.stringify({ ...body, generatedAt: sample.generatedAt })).toBe(JSON.stringify(sample));
  });

  it("finds the mentor whatever case the email is asked in, and answers it lowercase", async () => {
    await seedSample();
    const body = (await (await hours("?email=%20Mentor@FRESHMAN.academy%20")).json()) as HoursResponse;
    expect(body.mentor?.email).toBe("mentor@freshman.academy");
    expect(body.mentor?.sessions).toHaveLength(4);
  });

  it("is never cached", async () => {
    await seedSample();
    expect((await hours("?email=mentor@freshman.academy")).headers.get("cache-control")).toBe("no-store");
  });

  it("answers mentor: null for an email nobody has", async () => {
    const res = await hours("?email=nobody@freshman.academy");
    expect(res.status).toBe(200);
    const body = (await res.json()) as HoursResponse;
    expect(body).toMatchObject({ version: 1, mentor: null });
  });

  it("answers empty rates and sessions for somebody with no rate, however much they logged", async () => {
    const m = await mentor("No Rate");
    const s = await student();
    await prisma.session.create({
      data: { id: "logged", mentorId: m.id, studentId: s.id, programId: s.enrollments[0].programId, minutes: 60, date: day("2026-11-02") },
    });
    const body = (await (await hours(`?email=${m.email}`)).json()) as HoursResponse;
    expect(body.mentor).toEqual({ email: m.email, name: "No Rate", rates: [], sessions: [] });
  });

  it("names a student by email when they have no name", async () => {
    const { m } = await seedSample();
    const nameless = await student({ name: "x" });
    await prisma.user.update({ where: { id: nameless.userId }, data: { name: null } });
    await prisma.session.create({
      data: { id: "s-nameless", mentorId: m.id, studentId: nameless.id, programId: nameless.enrollments[0].programId, minutes: 30, date: day("2026-12-21") },
    });
    const body = (await (await hours("?email=mentor@freshman.academy")).json()) as HoursResponse;
    const row = body.mentor!.sessions.find((s) => s.id === "s-nameless")!;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: nameless.userId } });
    expect(row.student).toBe(user.email);
  });
});

describe("GET /api/payroll/v1/hours — refusals", () => {
  it("is 503 for every call while the secret is unset, even with a bearer", async () => {
    delete process.env.PAYROLL_API_SECRET;
    expect((await hours("?email=a@b.c")).status).toBe(503);
    expect((await hours("?email=a@b.c", null)).status).toBe(503);
    expect((await mentors()).status).toBe(503);
  });

  it("treats a blank secret as unset, so an empty bearer opens nothing", async () => {
    process.env.PAYROLL_API_SECRET = "";
    expect((await hours("?email=a@b.c", "Bearer ")).status).toBe(503);
  });

  it("is 401 with no header, a wrong secret, a prefix of it, or the wrong scheme", async () => {
    await seedSample();
    for (const auth of [null, "Bearer wrong", `Bearer ${SECRET.slice(0, -1)}`, `Bearer ${SECRET}x`, `Basic ${SECRET}`, SECRET, `bearer  ${SECRET}`]) {
      const res = await hours("?email=mentor@freshman.academy", auth);
      expect(res.status, String(auth)).toBe(401);
      expect(JSON.stringify(await res.json())).not.toContain("s-dec02");
    }
    expect((await mentors(null)).status).toBe(401);
    expect((await mentors("Bearer wrong")).status).toBe(401);
  });

  it("checks the secret before the email: no email and no secret is 401", async () => {
    expect((await hours("", null)).status).toBe(401);
  });

  it("is 400 without an email", async () => {
    expect((await hours("")).status).toBe(400);
    expect((await hours("?email=")).status).toBe(400);
    expect((await hours("?email=%20%20")).status).toBe(400);
  });
});

describe("GET /api/payroll/v1/mentors", () => {
  it("lists every mentor with a rate, by email, with today's rate and payable minutes", async () => {
    const { m, boss } = await seedSample();
    // A second mentor whose rate started a year ago and changed to 0 since.
    const zed = await prisma.user.create({ data: { email: "aaa@freshman.academy", name: "Aaa Mentor", role: ROLES.MENTOR } });
    await prisma.mentorPayRate.create({ data: { mentorId: zed.id, centsPerHour: 1500, effectiveFrom: day("2025-01-01"), createdById: boss.id } });
    await prisma.mentorPayRate.create({ data: { mentorId: zed.id, centsPerHour: 0, effectiveFrom: day("2025-06-01"), createdById: boss.id } });
    const s = await student();
    await prisma.session.create({ data: { mentorId: zed.id, studentId: s.id, programId: s.enrollments[0].programId, minutes: 50, date: day("2025-07-01") } });
    // Somebody with no rate is not listed.
    await mentor("Unpaid Mentor");

    const res = await mentors();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as MentorsResponse;
    expect(body.version).toBe(1);

    const today = programToday();
    // The sample mentor's rates start in December 2026; today may be before.
    const sampleRate = today >= "2026-12-15" ? 2500 : today >= "2026-12-01" ? 2000 : 0;
    expect(body.mentors).toEqual([
      { email: "aaa@freshman.academy", name: "Aaa Mentor", centsPerHour: 0, paidFrom: "2025-01-01", payableMinutes: 50 },
      { email: m.email, name: "Test Mentor", centsPerHour: sampleRate, paidFrom: "2026-12-01", payableMinutes: 60 + 45 + 90 + 25 },
    ]);
  });

  it("is an empty list when nobody has a rate", async () => {
    await mentor();
    const body = (await (await mentors()).json()) as MentorsResponse;
    expect(body.mentors).toEqual([]);
  });
});
