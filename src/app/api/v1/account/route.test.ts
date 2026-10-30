import { beforeEach, describe, expect, it, vi } from "vitest";

import { readChangelog, snapshotChangelog } from "@/lib/changelog";
import { prisma } from "@/lib/prisma";
import { bugReport, mentor, pairing, program, student, cohort } from "@/test/db";

/**
 * Account, read as the signed-in `actor`. What it pins is that each part is
 * there only for whoever it is theirs: a handle for a student, booking links
 * for a mentor, and the switches defaulted as /settings defaults them.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/account/route");

const as = (s: { userId: string } | { id: string }) => {
  actor.value = { id: "userId" in s ? s.userId : s.id };
};

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/account", () => {
  it("answers 401 with no user", async () => expect((await GET()).status).toBe(401));

  it("answers 403 inactive to a pending student", async () => {
    as(await student({ status: "PENDING" }));
    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("gives a student a handle and no booking links", async () => {
    const s = await student({ name: "Aziza Karimova" });
    await prisma.studentProfile.update({ where: { id: s.id }, data: { telegramUsername: "aziza_k" } });
    as(s);
    const body = await (await GET()).json();
    expect(body).toMatchObject({ name: "Aziza Karimova", telegram: { handle: "aziza_k" }, bookingLinks: null, avatarPath: null });
    expect(body.email).toMatch(/@/);
  });

  it("gives a mentor their pairings, labelled as Settings labels them, and no handle", async () => {
    const m = await mentor("Akmal Karimov");
    const p = await program("Global Admissions");
    const c = await cohort({ programId: p.id, name: "Cohort A" });
    const first = await pairing({ mentorId: m.id, programId: p.id });
    await prisma.mentorAssignment.update({ where: { id: first.id }, data: { calendlyUrl: "https://cal.example/akmal" } });
    const second = await pairing({ mentorId: m.id, programId: p.id, cohortId: c.id });
    // Someone else's pairing is not on it.
    await pairing({ mentorId: (await mentor("Other Mentor")).id, programId: p.id });
    as(m);
    const body = await (await GET()).json();
    expect(body.telegram).toBeNull();
    expect(body.bookingLinks).toEqual([
      { assignment: first.id, label: "Global Admissions", url: "https://cal.example/akmal" },
      { assignment: second.id, label: "Global Admissions · Cohort A", url: null },
    ]);
  });

  it("gives a student who mentors both", async () => {
    const s = await student();
    await prisma.user.update({ where: { id: s.userId }, data: { isMentor: true } });
    as(s);
    const body = await (await GET()).json();
    expect(body.telegram).toEqual({ handle: null });
    expect(body.bookingLinks).toEqual([]);
  });

  it("defaults each category as /settings does, and reads a stored one", async () => {
    const m = await mentor();
    await prisma.notificationPreference.create({ data: { userId: m.id, category: "HOURS", inApp: false, email: true } });
    as(m);
    const { notices, weeklyDigest } = await (await GET()).json();
    expect(notices.map((n: { category: string }) => n.category)).toEqual(["HOURS", "SESSIONS", "TASKS", "DEADLINES", "ACCOUNTS"]);
    expect(notices[0]).toMatchObject({ label: "Hours", inApp: false, email: true });
    expect(notices[0].hint).toBeTruthy();
    // TASKS is emailed unless somebody says otherwise; SESSIONS isn't.
    expect(notices[1]).toMatchObject({ inApp: true, email: false });
    expect(notices[2]).toMatchObject({ label: "Tasks and agenda", inApp: true, email: true });
    expect(typeof weeklyDigest).toBe("boolean");
  });

  it("says Tasks is the only category anything emails, so only it gets an Email switch", async () => {
    as(await mentor());
    const { notices } = await (await GET()).json();
    expect(notices.filter((n: { emailSent: boolean }) => n.emailSent).map((n: { category: string }) => n.category)).toEqual(["TASKS"]);
  });

  it("marks what's new until the changelog is read, and counts open reports only", async () => {
    const m = await mentor();
    await prisma.user.update({ where: { id: m.id }, data: { createdAt: new Date("2025-01-01T00:00:00Z") } });
    await bugReport({ reporterId: m.id });
    await bugReport({ reporterId: m.id, status: "IN_REVIEW" });
    await bugReport({ reporterId: m.id, status: "FIXED", resolution: "Fixed." });
    await bugReport({ reporterId: (await mentor("Someone Else")).id });
    as(m);
    expect(await (await GET()).json()).toMatchObject({ whatsNew: true, openBugs: 2 });

    await prisma.user.update({ where: { id: m.id }, data: { changelogSeen: snapshotChangelog(await readChangelog()) } });
    expect((await (await GET()).json()).whatsNew).toBe(false);
  });

  it("names the API's own address for the picture", async () => {
    const m = await mentor();
    await prisma.user.update({ where: { id: m.id }, data: { avatarUpdatedAt: new Date(1_790_000_000_000) } });
    as(m);
    expect((await (await GET()).json()).avatarPath).toBe(`/api/v1/avatars/${m.id}?v=1790000000000`);
  });
});
