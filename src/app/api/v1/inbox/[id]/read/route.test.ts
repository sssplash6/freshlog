import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";

import { student, program } from "@/test/db";

/** Marking one notification read: its own, another person's, and one that was never made. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { POST } = await import("@/app/api/v1/inbox/[id]/read/route");

const post = (id: string) => POST(new Request("http://test", { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  actor.value = null;
});

describe("POST /api/v1/inbox/:id/read", () => {
  it("answers 401 with no user", async () => expect((await post("x")).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    const aziz = await student({ status: "PENDING" });
    actor.value = { id: aziz.userId };
    const res = await post("x");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("another person's notification answers like a missing one, and stays unread", async () => {
    const aziz = await student({ name: "Aziz Tursunov" });
    const other = await student({ name: "Other Student", programId: (await program("Other Program")).id });
    const theirs = await prisma.notification.create({ data: { userId: other.userId, type: "TASK_SET", message: "Theirs" } });
    actor.value = { id: aziz.userId };
    const res = await post(theirs.id);
    const missing = await post("c-made-up");
    expect(res.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await res.json()).toEqual(await missing.json());
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).read).toBe(false);
  });

  it("marks its own read with 204, and again with 204 and no change", async () => {
    const aziz = await student({ name: "Aziz Tursunov" });
    const n = await prisma.notification.create({ data: { userId: aziz.userId, type: "TASK_SET", message: "Mine" } });
    actor.value = { id: aziz.userId };
    const res = await post(n.id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const first = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(first).toMatchObject({ read: true });
    expect(first.readAt).toBeInstanceOf(Date);
    expect((await post(n.id)).status).toBe(204);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt).toEqual(first.readAt);
  });
});
