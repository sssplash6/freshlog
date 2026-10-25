import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, cohort, grant, level, mentor, program, student } from "@/test/db";

/**
 * Sign-up as the signed-in `actor`. What is pinned is that the form a person
 * gets is /onboarding's branching, never theirs to pick, and that it serves an
 * account that isn't active yet, which every other route turns away.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET, POST } = await import("@/app/api/v1/onboarding/route");

let seq = 0;
const post = (body: unknown) =>
  POST(new Request("http://test/api/v1/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

/** Somebody who signed in with Google and was made a PENDING student on the spot: no profile yet. */
const newcomer = (name: string | null = null) =>
  prisma.user.create({ data: { email: `new${++seq}@gmail.example`, name, role: "STUDENT", status: "PENDING" } });

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/onboarding", () => {
  it("answers 401 with no user", async () => expect((await GET()).status).toBe(401));

  it("gives a newcomer the registration form with every active program", async () => {
    const p = await program("Global Admissions");
    const lv = await level({ programId: p.id, name: "Emerging" });
    await cohort({ programId: p.id, levelId: lv.id, name: "Cohort A" });
    const archived = await program("Old Program");
    await prisma.program.update({ where: { id: archived.id }, data: { status: "ARCHIVED" } });
    actor.value = { id: (await newcomer()).id };
    const body = await (await GET()).json();
    expect(body.step).toBe("register");
    expect(body.programs.map((x: { name: string }) => x.name)).toEqual(["Global Admissions"]);
    expect(body.programs[0].levels[0]).toMatchObject({ name: "Emerging", cohorts: [{ name: "Cohort A" }] });
  });

  it("gives a staff-registered student the details form, welcomed to where they study", async () => {
    const p = await program("Global Admissions Program");
    const c = await cohort({ programId: p.id, name: "Cohort A" });
    const s = await student({ programId: p.id, cohortId: c.id, status: "PENDING" });
    actor.value = { id: s.userId };
    expect(await (await GET()).json()).toEqual({
      step: "details",
      name: "Test Student",
      welcome: "the Global Admissions Program",
      eyebrow: "Step 1 of 2 · Cohort A",
      pending: true,
    });
  });

  it("gives a mentor with no name the name form, and nothing once named", async () => {
    const m = await prisma.user.create({ data: { email: "m@freshman.example", role: "MENTOR", status: "UNASSIGNED" } });
    actor.value = { id: m.id };
    expect(await (await GET()).json()).toEqual({ step: "mentor-name", name: "" });
    await prisma.user.update({ where: { id: m.id }, data: { name: "Akmal Karimov" } });
    expect(await (await GET()).json()).toEqual({ step: null });
  });

  it("asks nothing of staff, or of a student with nothing missing", async () => {
    actor.value = { id: (await admin()).id };
    expect(await (await GET()).json()).toEqual({ step: null });
    const s = await student();
    await prisma.studentProfile.update({ where: { id: s.id }, data: { telegramUsername: "aziza_k" } });
    actor.value = { id: s.userId };
    expect(await (await GET()).json()).toEqual({ step: null });
  });
});

describe("POST /api/v1/onboarding", () => {
  it("registers a newcomer into a program, tells its admins, and leaves them waiting", async () => {
    const p = await program("Global Admissions");
    const c = await cohort({ programId: p.id, name: "Cohort A" });
    const staff = await admin("Program Admin");
    await grant({ userId: staff.id, programId: p.id });
    const u = await newcomer();
    actor.value = { id: u.id };

    const res = await post({ name: "Aziza  Karimova", telegram: "@aziza_k", program: p.id, cohort: c.id });
    expect(await res.json()).toEqual({ ok: true });
    const profile = await prisma.studentProfile.findUnique({ where: { userId: u.id }, include: { enrollments: true } });
    expect(profile).toMatchObject({ telegramUsername: "aziza_k" });
    expect(profile?.enrollments).toMatchObject([{ programId: p.id, cohortId: c.id }]);
    expect(await prisma.user.findUnique({ where: { id: u.id } })).toMatchObject({ name: "Aziza Karimova", status: "PENDING" });
    expect(await prisma.notification.count({ where: { userId: staff.id, type: "STUDENT_SIGNUP" } })).toBe(1);

    // Sent once: the next is refused, and the wait is what is left.
    expect(await (await GET()).json()).toEqual({ step: null });
    const again = await post({ name: "Aziza Karimova", telegram: "aziza_k", program: p.id, cohort: c.id });
    expect(again.status).toBe(400);
    expect((await again.json()).error).toBe("Nothing left to fill in.");
  });

  it("names the box freshform refuses: the name, the handle, then the program's level", async () => {
    const p = await program("Research");
    await level({ programId: p.id, name: "Emerging" });
    actor.value = { id: (await newcomer()).id };
    expect(await (await post({ name: "Aziza", telegram: "aziza_k", program: p.id })).json()).toMatchObject({ field: "name" });
    expect(await (await post({ name: "Aziza Karimova", telegram: "ab", program: p.id })).json()).toMatchObject({ field: "telegram" });
    const res = await post({ name: "Aziza Karimova", telegram: "aziza_k", program: p.id });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "program", error: "Pick a level in Research." });
  });

  it("completes a staff-registered student's details, whatever program fields they send", async () => {
    const p = await program();
    const s = await student({ programId: p.id });
    const elsewhere = await program("Elsewhere");
    actor.value = { id: s.userId };
    expect(await (await post({ name: "Bekzod Tursunov", telegram: "bekzod_t", program: elsewhere.id })).json()).toEqual({ ok: true });
    const profile = await prisma.studentProfile.findUnique({ where: { id: s.id }, include: { enrollments: true } });
    expect(profile?.telegramUsername).toBe("bekzod_t");
    expect(profile?.enrollments.map((e) => e.programId)).toEqual([p.id]);
  });

  it("names a mentor", async () => {
    const m = await prisma.user.create({ data: { email: "n@freshman.example", role: "MENTOR", status: "UNASSIGNED" } });
    actor.value = { id: m.id };
    expect(await (await post({ name: "Akmal Karimov" })).json()).toEqual({ ok: true });
    expect((await prisma.user.findUnique({ where: { id: m.id } }))?.name).toBe("Akmal Karimov");
  });

  it("refuses somebody with nothing left, mentor or not", async () => {
    actor.value = { id: (await mentor()).id };
    expect((await post({ name: "New Name" })).status).toBe(400);
  });
});
