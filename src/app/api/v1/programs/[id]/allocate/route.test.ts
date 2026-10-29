import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, allocation, grant, mentor, program, session, student } from "@/test/db";

/** A program's Allocate time picker, as its admin reads it. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/programs/[id]/allocate/route");

const get = (id: string) => GET(new Request("http://test"), { params: Promise.resolve({ id }) });

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/programs/:id/allocate", () => {
  it("groups the roster as the page does, each with what they hold in the program, and warns of the overdrawn", async () => {
    const ga = await program("Global Admissions");
    const akmal = await mentor("Akmal Karimov");
    const holds = await student({ programId: ga.id, name: "Aziz Tursunov" });
    const fresh = await student({ programId: ga.id, name: "Bekzod Aliev" });
    const over = await student({ programId: ga.id, name: "Dilshod Karimov" });
    await allocation({ studentId: holds.id, programId: ga.id, mentorId: akmal.id, minutes: 240 });
    await allocation({ studentId: over.id, programId: ga.id, mentorId: akmal.id, minutes: 60 });
    await session({ studentId: over.id, programId: ga.id, mentorId: akmal.id, minutes: 120 });
    const nodira = await admin("Nodira Aliyeva");
    await grant({ userId: nodira.id, programId: ga.id });
    actor.value = { id: nodira.id };

    const body = await (await get(ga.id)).json();
    expect(body.program).toMatchObject({ id: ga.id, name: "Global Admissions" });
    expect(body.rows.map((r: { student: { name: string }; group: string; hint: string; tone: string | null }) => [r.student.name, r.group, r.hint, r.tone])).toEqual([
      ["Aziz Tursunov", "Has time", "4h remaining", null],
      ["Bekzod Aliev", "All time used", "No time allocated yet", null],
      ["Dilshod Karimov", "Overdrawn or expired", "1h over", "danger"],
    ]);
    expect(body.rows[2].warning).toEqual({ lead: "Dilshod Karimov is already 1h over in Global Admissions.", rest: "Time granted now is added to that balance." });
    expect(body.rows[0].warning).toBeNull();
    expect(fresh.id).toBe(body.rows[1].student.id);
  });

  it("refuses a Leader, who may not grant, and answers 404 outside the reader's programs", async () => {
    const ga = await program("Global Admissions");
    const leader = await admin("Lola Leader");
    await grant({ userId: leader.id, programId: ga.id, role: "LEADER" });
    actor.value = { id: leader.id };
    expect((await get(ga.id)).status).toBe(403);
    actor.value = { id: (await admin("Nodira Aliyeva")).id };
    expect((await get(ga.id)).status).toBe(404);
  });
});
