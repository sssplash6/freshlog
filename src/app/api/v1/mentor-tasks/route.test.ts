import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, DAY, grant, mentor, NOW, program } from "@/test/db";

/**
 * A mentor's own tasks from their admins. Somebody who cannot act as a mentor
 * has none to list, and is answered like a page that does not exist.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/mentor-tasks/route");

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/mentor-tasks", () => {
  it("answers 401 with no user", async () => expect((await GET()).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    const m = await mentor("Akmal Karimov");
    await prisma.user.update({ where: { id: m.id }, data: { status: "UNASSIGNED" } });
    actor.value = { id: m.id };
    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("answers an admin who does not mentor like a page that does not exist", async () => {
    const a = await admin("Malika Yusupova");
    actor.value = { id: a.id };
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: "Not found." });
  });

  it("lists the mentor's open tasks, no-store", async () => {
    const p = await program("Global Admissions");
    const a = await admin("Malika Yusupova");
    await grant({ userId: a.id, programId: p.id });
    const m = await mentor("Akmal Karimov");
    await prisma.mentorTask.create({
      data: {
        programId: p.id,
        title: "Read the essays",
        dueOn: new Date(NOW.getTime() + 3 * DAY),
        createdById: a.id,
        assignees: { create: { mentorId: m.id } },
      },
    });
    actor.value = { id: m.id };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ title: "Read the essays", done: false, overdue: false });
  });
});
