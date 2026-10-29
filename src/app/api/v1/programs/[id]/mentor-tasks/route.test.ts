import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, grant, program, student } from "@/test/db";

/** A program's tasks for mentors, as its admin reads them. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/programs/[id]/mentor-tasks/route");
const get = (id: string) => GET(new Request("http://test"), { params: Promise.resolve({ id }) });

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/programs/:id/mentor-tasks", () => {
  it("offers every enrolled student as one a task may be about, one nobody has approved included, as the website's page", async () => {
    const ga = await program("Global Admissions");
    await student({ programId: ga.id, name: "Aziz Tursunov" });
    await student({ programId: ga.id, name: "Bekzod Pending", status: "PENDING" });
    const boss = await admin("Nodira Aliyeva");
    await grant({ userId: boss.id, programId: ga.id });
    actor.value = { id: boss.id };
    const body = await (await get(ga.id)).json();
    expect(body.students.map((s: { name: string }) => s.name)).toEqual(["Aziz Tursunov", "Bekzod Pending"]);
  });
});
