import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";

import type { InboxPage } from "@/lib/api/v1/types";
import { student, program } from "@/test/db";

/** The feed over HTTP: who is turned away, and what the URL asks for. How it orders and pages is `inbox.test.ts`'s. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/inbox/route");

const get = (query = "") => GET(new Request(`http://test/api/v1/inbox${query}`));

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/inbox", () => {
  it("answers 401 with no user", async () => {
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "Sign in again.", code: "unauthenticated" });
  });

  it("answers 403 inactive to an account that isn't active", async () => {
    const aziz = await student({ status: "PENDING" });
    actor.value = { id: aziz.userId };
    const res = await get();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("answers the reader's own notifications with a cursor, and never anybody else's", async () => {
    const aziz = await student({ name: "Aziz Tursunov" });
    const other = await student({ name: "Other Student", programId: (await program("Other Program")).id });
    for (let i = 0; i < 3; i++)
      await prisma.notification.create({ data: { userId: aziz.userId, type: "TASK_SET", message: `Task ${i}`, href: "/student", createdAt: new Date(Date.UTC(2026, 9, 20, 9, 0, i)) } });
    await prisma.notification.create({ data: { userId: other.userId, type: "TASK_SET", message: "Not yours" } });
    actor.value = { id: aziz.userId };
    const res = await get("?limit=2");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const page: InboxPage = await res.json();
    expect(page.items.map((i) => i.message)).toEqual(["Task 2", "Task 1"]);
    expect(page.items[0]).toMatchObject({ title: "New task", href: "/student", actor: null, read: false });
    expect(page.unread).toBe(3);
    const next: InboxPage = await (await get(`?limit=2&cursor=${page.nextCursor}`)).json();
    expect(next.items.map((i) => i.message)).toEqual(["Task 0"]);
    expect(next.nextCursor).toBeNull();
  });

  it("answers a bad cursor 400 with field cursor", async () => {
    const aziz = await student();
    actor.value = { id: aziz.userId };
    const res = await get("?cursor=garbage");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, field: "cursor" });
  });

  it("answers a bad limit 400 with field limit", async () => {
    const aziz = await student();
    actor.value = { id: aziz.userId };
    for (const q of ["?limit=abc", "?limit=0", "?limit=500"]) {
      const res = await get(q);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false, field: "limit" });
    }
  });
});
