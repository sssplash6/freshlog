import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, mentor } from "@/test/db";

const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/changelog", async (original) => ({
  ...(await original<typeof import("@/lib/changelog")>()),
  readChangelog: async () => [
    { date: "2026-10-02", new: ["a", "b"], fixed: ["c"] },
    { date: "2026-09-30", new: ["d"], fixed: [] },
  ],
}));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { markChangelogSeen } = await import("@/lib/actions/changelog");

const row = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });
const seen = async (id: string) => (await row(id)).changelogSeenAt;

describe("markChangelogSeen", () => {
  it("stamps the caller's own row and nobody else's", async () => {
    const me = await mentor("Me");
    const other = await admin("Somebody Else");
    actor.value = me;

    const before = Date.now();
    await markChangelogSeen();

    const stamp = await seen(me.id);
    expect(stamp).not.toBeNull();
    expect(stamp!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(stamp!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(await seen(other.id)).toBeNull();
    expect((await row(other.id)).changelogSeen).toBeNull();
  });

  it("records what the page held when they opened it", async () => {
    const me = await mentor("Me");
    actor.value = me;

    await markChangelogSeen();

    expect(JSON.parse((await row(me.id)).changelogSeen!)).toEqual({
      "2026-10-02": 3,
      "2026-09-30": 1,
    });
  });

  it("does nothing when nobody is signed in", async () => {
    const me = await mentor("Me");
    actor.value = null;

    await markChangelogSeen();

    expect(await seen(me.id)).toBeNull();
  });

  it("is safe to run twice", async () => {
    const me = await mentor("Me");
    actor.value = me;

    await markChangelogSeen();
    await markChangelogSeen();

    expect(await seen(me.id)).not.toBeNull();
  });
});
