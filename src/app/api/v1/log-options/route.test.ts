import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, allocation, grant, mentor, pairing, program, session, student } from "@/test/db";

/**
 * Who a mentor can log a session for. It is for somebody who can act as a
 * mentor; to anyone else the route does not exist.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET: route } = await import("@/app/api/v1/log-options/route");

/** The mentor's own options, or `?mentor=`'s on their behalf. */
const GET = (mentorId?: string) =>
  route(new Request(`http://test/api/v1/log-options${mentorId ? `?mentor=${mentorId}` : ""}`));

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

  it("offers the website's plan item presets, and narrows to one program's students with ?program=", async () => {
    const ga = await program("Global Admissions");
    const ms = await program("Master's Program");
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: ga.id });
    await pairing({ mentorId: m.id, programId: ms.id });
    const aziz = await student({ programId: ga.id, name: "Aziz Tursunov" });
    const bek = await student({ programId: ms.id, name: "Bekzod Aliev" });
    await allocation({ studentId: aziz.id, mentorId: m.id, minutes: 600 });
    await allocation({ studentId: bek.id, mentorId: m.id, minutes: 600 });
    actor.value = { id: m.id };
    const all = await (await GET()).json();
    expect(all.planPresets.length).toBeGreaterThan(0);
    expect(all.students.map((s: { name: string }) => s.name).sort()).toEqual(["Aziz Tursunov", "Bekzod Aliev"]);
    const one = await (await route(new Request(`http://test/api/v1/log-options?program=${ms.id}`))).json();
    expect(one.students.map((s: { name: string }) => s.name)).toEqual(["Bekzod Aliev"]);
  });

  describe("?mentor=, on a mentor's behalf", () => {
    async function twoPrograms() {
      const ga = await program("Global Admissions");
      const masters = await program("Master's Program");
      const akmal = await mentor("Akmal Karimov");
      await pairing({ mentorId: akmal.id, programId: ga.id });
      await pairing({ mentorId: akmal.id, programId: masters.id });
      const aziz = await student({ programId: ga.id, name: "Aziz Tursunov" });
      const sitora = await student({ programId: masters.id, name: "Sitora Nazarova" });
      await allocation({ studentId: aziz.id, mentorId: akmal.id, minutes: 300 });
      await allocation({ studentId: sitora.id, mentorId: akmal.id, minutes: 300 });
      await session({ studentId: sitora.id, mentorId: akmal.id, minutes: 45 });
      const nodira = await admin("Nodira Aliyeva");
      await grant({ userId: nodira.id, programId: ga.id });
      return { ga, masters, akmal, aziz, sitora, nodira };
    }

    it("answers that mentor's students in the programs the admin may change, and no others", async () => {
      const { akmal, aziz, nodira, ga } = await twoPrograms();
      actor.value = { id: nodira.id };
      const res = await GET(akmal.id);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.students).toEqual([expect.objectContaining({ id: aziz.id, programs: [expect.objectContaining({ program: expect.objectContaining({ id: ga.id }) })] })]);
      expect(JSON.stringify(body)).not.toContain("Sitora");
      expect(body.recent).toEqual([]);
    });

    it("a mentor the admin may not log for, and a Leader, are answered as not found", async () => {
      const { ga, nodira } = await twoPrograms();
      const stranger = await mentor("Umid Rashidov");
      await pairing({ mentorId: stranger.id, programId: (await program("Other")).id });
      actor.value = { id: nodira.id };
      expect(await (await GET(stranger.id)).json()).toEqual(NOT_FOUND);
      const leader = await admin("Lola Leader");
      await grant({ userId: leader.id, programId: ga.id, role: "LEADER" });
      actor.value = { id: leader.id };
      const { akmal } = { akmal: (await prisma.user.findFirstOrThrow({ where: { name: "Akmal Karimov" } })) };
      expect((await GET(akmal.id)).status).toBe(404);
    });
  });
});
