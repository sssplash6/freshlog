import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, allocation, grant, mentor, pairing, program, student } from "@/test/db";

/**
 * The mentor's home belongs to somebody who can act as a mentor, and to nobody
 * else. A student, and an admin who does not mentor, are answered as if there
 * were no such page, so the answer cannot be used to find out who mentors.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/mentor/home/route");

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/mentor/home", () => {
  it("answers 401 with no user", async () => {
    expect((await GET(new Request("http://test/api/v1/mentor/home"))).status).toBe(401);
  });

  it("answers 403 inactive to a mentor no program has taken on yet", async () => {
    const m = await prisma.user.update({
      where: { id: (await mentor("Akmal Karimov")).id },
      data: { status: "UNASSIGNED" },
    });
    actor.value = { id: m.id };
    const res = await GET(new Request("http://test/api/v1/mentor/home"));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("answers a student like a page that does not exist", async () => {
    const s = await student({ name: "Aziz Tursunov" });
    actor.value = { id: s.userId };
    const res = await GET(new Request("http://test/api/v1/mentor/home"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "Not found." });
  });

  it("answers an admin who does not mentor the same way, and not with the staff's list", async () => {
    const p = await program("Global Admissions");
    const nodira = await admin("Nodira Aliyeva");
    await grant({ userId: nodira.id, programId: p.id });
    // Something for the staff's list to say, were it the answer.
    await student({ programId: p.id, name: "Aziz Tursunov", status: "PENDING" });
    actor.value = { id: nodira.id };
    const res = await GET(new Request("http://test/api/v1/mentor/home"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "Not found." });
  });

  it("answers a mentor with their home", async () => {
    const p = await program("Global Admissions");
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: p.id });
    const s = await student({ programId: p.id, name: "Aziz Tursunov" });
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 300 });
    actor.value = { id: m.id };

    const res = await GET(new Request("http://test/api/v1/mentor/home"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const home = await res.json();
    expect(home.summary).toEqual({ remaining: 300, completed: 0, students: 1, expiring: 0, disputed: 0 });
    expect(home.students).toHaveLength(1);
    expect(home.students[0]).toMatchObject({
      student: { id: s.id, name: "Aziz Tursunov" },
      program: { id: p.id, name: "Global Admissions" },
      allocated: 300,
      remaining: 300,
    });
    expect(Array.isArray(home.todo)).toBe(true);
  });
});
