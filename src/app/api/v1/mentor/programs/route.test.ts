import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { allocation, mentor, pairing, program, student } from "@/test/db";

/** A mentor's programs, as the website's /programs lists them in the mentor lens. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/mentor/programs/route");

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/mentor/programs", () => {
  it("answers 401, and a 404 to somebody who can't act as a mentor", async () => {
    expect((await GET()).status).toBe(401);
    actor.value = { id: (await student()).userId };
    expect((await GET()).status).toBe(404);
  });

  it("lists each program the mentor works in, with their students and hours there, and one they wait in", async () => {
    const ga = await program("Global Admissions");
    const ms = await program("Master's Program");
    const m = await mentor("Akmal Karimov");
    await pairing({ mentorId: m.id, programId: ga.id });
    await pairing({ mentorId: m.id, programId: ms.id });
    const aziz = await student({ programId: ga.id, name: "Aziz Tursunov" });
    await allocation({ studentId: aziz.id, mentorId: m.id, minutes: 300 });
    actor.value = { id: m.id };
    const rows = await (await GET()).json();
    expect(rows).toEqual([
      expect.objectContaining({ id: ga.id, name: "Global Admissions", students: 1, completed: 0, remaining: 300 }),
      expect.objectContaining({ id: ms.id, name: "Master's Program", students: 0, completed: 0, remaining: 0 }),
    ]);
  });
});
