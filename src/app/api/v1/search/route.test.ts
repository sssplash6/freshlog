import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, allocation, grant, mentor, pairing, program, student } from "@/test/db";

/** Search: the command palette's people, to the readers it answers, and nobody else. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/search/route");
const get = (q?: string) => GET(new Request(`http://test/api/v1/search${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`));

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/search", () => {
  it("answers 401 with no user, and 404 to a student, asked or not", async () => {
    expect((await get("az")).status).toBe(401);
    const s = await student();
    actor.value = { id: s.userId };
    expect((await get("az")).status).toBe(404);
    expect((await get()).status).toBe(404);
  });

  it("finds an admin's students and mentors in their programs only, best match first", async () => {
    const ga = await program("Global Admissions");
    const other = await program("Other");
    await student({ programId: ga.id, name: "Nazarbek Aliev" });
    await student({ programId: ga.id, name: "Aziza Karimova" });
    await student({ programId: other.id, name: "Azamat Elsewhere" });
    const m = await mentor("Azim Mentor");
    await pairing({ mentorId: m.id, programId: ga.id });
    const a = await admin();
    await grant({ userId: a.id, programId: ga.id });
    actor.value = { id: a.id };
    const body = await (await get("az")).json();
    expect(body.students.map((s: { name: string }) => s.name)).toEqual(["Aziza Karimova", "Nazarbek Aliev"]);
    expect(body.students[0].programs).toEqual(["Global Admissions"]);
    expect(body.mentors.map((x: { name: string }) => x.name)).toEqual(["Azim Mentor"]);
    expect(JSON.stringify(body)).not.toContain("Elsewhere");
    expect(await (await get("")).json()).toEqual({ students: [], mentors: [] });
  });

  it("finds a mentor's own students only, and no mentors", async () => {
    const ga = await program();
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: ga.id });
    const mine = await student({ programId: ga.id, name: "Aziz Mine" });
    await allocation({ studentId: mine.id, mentorId: m.id, minutes: 60 });
    await student({ programId: (await program("Far")).id, name: "Aziz Theirs" });
    actor.value = { id: m.id };
    const body = await (await get("aziz")).json();
    expect(body.students.map((s: { name: string }) => s.name)).toEqual(["Aziz Mine"]);
    expect(body.mentors).toEqual([]);
  });
});
