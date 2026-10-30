import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { student } from "@/test/db";

/** Opening one notification: it is marked read, with the instant, and the reader is sent on. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  requireUser: async () => {
    if (!actor.value) throw new Error("redirect:/login");
    return prisma.user.findUniqueOrThrow({ where: { id: actor.value.id } });
  },
}));

const { GET } = await import("@/app/n/[id]/route");

const open = (id: string) => GET(new Request(`http://test/n/${id}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  actor.value = null;
});

describe("GET /n/[id]", () => {
  it("marks an unread notice read and stamps when, as Mark all read does", async () => {
    const aziz = await student();
    const n = await prisma.notification.create({ data: { userId: aziz.userId, type: "TASK_SET", message: "x", href: "/student" } });
    actor.value = { id: aziz.userId };
    const before = Date.now();
    const res = await open(n.id);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/student");
    const row = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.read).toBe(true);
    expect(row.readAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("leaves a notice already read, and its instant, as they were", async () => {
    const aziz = await student();
    const readAt = new Date(Date.UTC(2026, 9, 1, 9));
    const n = await prisma.notification.create({ data: { userId: aziz.userId, type: "TASK_SET", message: "x", read: true, readAt } });
    actor.value = { id: aziz.userId };
    await open(n.id);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt).toEqual(readAt);
  });
});
