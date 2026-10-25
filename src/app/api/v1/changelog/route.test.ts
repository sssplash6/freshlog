import { beforeEach, describe, expect, it, vi } from "vitest";

import { readChangelog } from "@/lib/changelog";
import { prisma } from "@/lib/prisma";
import { mentor, student } from "@/test/db";

/** What's new: the website's changelog, and what the reader has seen of it. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/changelog/route");
const { POST } = await import("@/app/api/v1/changelog/seen/route");

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/changelog and POST changelog/seen", () => {
  it("answers 401 with no user, and 403 inactive to a pending student", async () => {
    expect((await GET()).status).toBe(401);
    expect((await POST()).status).toBe(401);
    const s = await student({ status: "PENDING" });
    actor.value = { id: s.userId };
    expect((await GET()).status).toBe(403);
    expect((await POST()).status).toBe(403);
  });

  it("gives the days newest first, each item as a headline over its detail", async () => {
    actor.value = { id: (await mentor()).id };
    const { days } = await (await GET()).json();
    const entries = await readChangelog();
    expect(days.map((d: { day: string }) => d.day)).toEqual(entries.map((e) => e.date));
    expect([...days].sort((a, b) => (a.day < b.day ? 1 : -1))).toEqual(days);
    const first = days.find((d: { new: unknown[] }) => d.new.length > 0);
    expect(Object.keys(first.new[0]).sort()).toEqual(["detail", "headline"]);
  });

  it("marks days unseen until the reader has opened it, then none", async () => {
    const m = await mentor();
    await prisma.user.update({ where: { id: m.id }, data: { createdAt: new Date("2025-01-01T00:00:00Z") } });
    actor.value = { id: m.id };
    expect((await (await GET()).json()).days.some((d: { unseen: boolean }) => d.unseen)).toBe(true);
    expect((await POST()).status).toBe(204);
    expect((await (await GET()).json()).days.some((d: { unseen: boolean }) => d.unseen)).toBe(false);
  });

  it("doesn't hand somebody new the history from before they joined", async () => {
    actor.value = { id: (await mentor()).id };
    const today = new Date().toISOString().slice(0, 10);
    const { days } = await (await GET()).json();
    expect(days.filter((d: { unseen: boolean; day: string }) => d.unseen && d.day <= today)).toEqual([]);
  });
});
