import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, grant, mentor, program, session, student } from "@/test/db";

/** Analytics: the website's read for staff and mentors, never a student's name, and nothing for a student. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/analytics/route");
const get = (q = "") => GET(new Request(`http://test/api/v1/analytics${q}`));

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/analytics", () => {
  it("answers 401 with no user, and 404 to a student", async () => {
    expect((await get()).status).toBe(401);
    const s = await student();
    actor.value = { id: s.userId };
    expect((await get()).status).toBe(404);
  });

  it("gives staff the school's sessions, mentors named, students only as numbers", async () => {
    const p = await program("Global Admissions");
    const m = await mentor("Dilnoza Yusupova");
    const s = await student({ programId: p.id, name: "Aziz Tursunov" });
    await session({ studentId: s.id, mentorId: m.id, minutes: 60 });
    await session({ studentId: s.id, mentorId: m.id, minutes: 30, attended: false });
    const a = await admin();
    await grant({ userId: a.id, programId: p.id });
    actor.value = { id: a.id };
    const body = await (await get()).json();
    expect(body).toMatchObject({ audience: "staff", self: null });
    expect(body.mentors.map((x: { name: string }) => x.name)).toContain("Dilnoza Yusupova");
    expect(body.programs.map((x: { name: string }) => x.name)).toContain("Global Admissions");
    const mine = body.sessions.filter((r: number[]) => body.mentors[r[1]].id === m.id);
    expect(mine.map((r: number[]) => [r[4], r[5]]).sort()).toEqual([[30, 2], [60, 0]]);
    expect(JSON.stringify(body)).not.toContain("Aziz");
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("answers a person who mentors and administers on the side the app says it is on, as the website's cookie does", async () => {
    const p = await program("Global Admissions");
    const both = await prisma.user.update({ where: { id: (await admin()).id }, data: { isMentor: true } });
    await grant({ userId: both.id, programId: p.id });
    actor.value = { id: both.id };
    expect(await (await get("?as=mentor")).json()).toMatchObject({ audience: "mentor", self: both.id });
    expect(await (await get("?as=admin")).json()).toMatchObject({ audience: "staff", self: null });
    // No side named is the website's default, the admin's.
    expect(await (await get()).json()).toMatchObject({ audience: "staff" });
    // A plain mentor is a mentor whatever they ask.
    const m = await mentor("Dilnoza Yusupova");
    actor.value = { id: m.id };
    expect(await (await get("?as=admin")).json()).toMatchObject({ audience: "mentor", self: m.id });
  });
});
