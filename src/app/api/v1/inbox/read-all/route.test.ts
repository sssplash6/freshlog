import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";

import { student, program } from "@/test/db";

/** Marking everything read: only the reader's own, and only through the website's action. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { POST } = await import("@/app/api/v1/inbox/read-all/route");

const post = () => POST();

beforeEach(() => {
  actor.value = null;
});

describe("POST /api/v1/inbox/read-all", () => {
  it("answers 401 with no user", async () => expect((await post()).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    const aziz = await student({ status: "PENDING" });
    actor.value = { id: aziz.userId };
    const res = await post();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("marks every one of the reader's notifications read with 204, and nobody else's", async () => {
    const aziz = await student({ name: "Aziz Tursunov" });
    const other = await student({ name: "Other Student", programId: (await program("Other Program")).id });
    for (const userId of [aziz.userId, aziz.userId, other.userId])
      await prisma.notification.create({ data: { userId, type: "TASK_SET", message: "x" } });
    actor.value = { id: aziz.userId };
    const res = await post();
    expect(res.status).toBe(204);
    expect(await prisma.notification.count({ where: { userId: aziz.userId, read: false } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: aziz.userId, readAt: { not: null } } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: other.userId, read: false } })).toBe(1);
  });
});
