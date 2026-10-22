import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, allocation, mentor, pairing, program, student } from "@/test/db";

/**
 * Who a mentor can log a session for. It is for somebody who can act as a
 * mentor; to anyone else the route does not exist.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/log-options/route");

beforeEach(() => {
  actor.value = null;
});

const NOT_FOUND = { ok: false, error: "Not found." };

describe("GET /api/v1/log-options", () => {
  it("answers 401 with no user", async () => expect((await GET()).status).toBe(401));

  it("answers 403 inactive to a mentor no program has taken on", async () => {
    const m = await prisma.user.update({
      where: { id: (await mentor("Akmal Karimov")).id },
      data: { status: "UNASSIGNED" },
    });
    actor.value = { id: m.id };
    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("answers 404 to a student", async () => {
    const s = await student({ name: "Aziz Tursunov" });
    actor.value = { id: s.userId };
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
  });

  it("answers 404 to an admin who does not mentor", async () => {
    actor.value = { id: (await admin("Nodira Aliyeva")).id };
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
  });

  it("answers an admin who also mentors like any mentor", async () => {
    const a = await prisma.user.update({
      where: { id: (await admin("Nodira Aliyeva")).id },
      data: { isMentor: true },
    });
    actor.value = { id: a.id };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ students: [], recent: [] });
  });

  it("answers a mentor with who they can log for, in the contract's shape and nothing more", async () => {
    const p = await program("Global Admissions");
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: p.id });
    const st = await student({ programId: p.id, name: "Aziz Tursunov" });
    await allocation({ studentId: st.id, mentorId: m.id, minutes: 600 });
    actor.value = { id: m.id };

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.recent).toEqual([]);
    expect(body.students).toHaveLength(1);
    expect(body.students[0]).toMatchObject({ id: st.id, name: "Aziz Tursunov" });
    // The website's English (`balance`, `hint`) is not the app's to show.
    expect(Object.keys(body.students[0]).sort()).toEqual(["id", "name", "programs"]);
    expect(Object.keys(body.students[0].programs[0]).sort()).toEqual([
      "allocated",
      "goals",
      "program",
      "remaining",
      "state",
      "useBy",
    ]);
    expect(body.students[0].programs[0]).toMatchObject({ state: "ready", allocated: 600, remaining: 600 });
  });
});
