import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { allocation, mentor, pairing, program, session, student } from "@/test/db";

/**
 * The student's home belongs to somebody with a student record, and to nobody
 * else. A mentor is answered as if there were no such page, so the answer cannot
 * be used to find out who studies.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/student/home/route");

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/student/home", () => {
  it("answers 401 with no user", async () => {
    expect((await GET()).status).toBe(401);
  });

  it("answers 403 inactive to a student nobody has approved yet", async () => {
    const s = await student({ name: "Aziz Tursunov", status: "PENDING" });
    actor.value = { id: s.userId };
    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("answers a mentor like a page that does not exist", async () => {
    const m = await mentor("Akmal Karimov");
    actor.value = { id: m.id };
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "Not found." });
  });

  it("answers a student with their home", async () => {
    const p = await program("Global Admissions");
    const m = await mentor("Akmal Karimov");
    const pair = await pairing({ mentorId: m.id, programId: p.id });
    await prisma.mentorAssignment.update({
      where: { id: pair.id },
      data: { calendlyUrl: "https://calendly.com/akmal-karimov" },
    });
    const s = await student({ programId: p.id, name: "Aziz Tursunov" });
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 300 });
    const logged = await session({ studentId: s.id, mentorId: m.id, minutes: 60 });
    actor.value = { id: s.userId };

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const home = await res.json();
    expect(home.hours).toEqual({ allotted: 300, used: 60, remaining: 240, forfeited: 0, extra: 0 });
    expect(home.grants).toHaveLength(1);
    expect(home.grants[0]).toMatchObject({
      mentor: { id: m.id, name: "Akmal Karimov" },
      program: { id: p.id, name: "Global Admissions" },
      allocated: 300,
      remaining: 240,
      bookingUrl: "https://calendly.com/akmal-karimov",
    });
    expect(home.todo.find((row: { type: string }) => row.type === "SESSION_UNCONFIRMED")).toMatchObject({
      sessionId: logged.id,
    });
    expect(home.toConfirm).toBe(1);
  });
});
