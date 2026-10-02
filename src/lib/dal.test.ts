import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { mentor, platformAdmin } from "@/test/db";

const session = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (session.id ? { user: { id: session.id } } : null),
}));

// `getCurrentUser` is wrapped in React's `cache`; a fresh module per test keeps
// one test's user from answering for the next.
beforeEach(() => {
  vi.resetModules();
  session.id = null;
});

const load = () => import("@/lib/dal");

const digestOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return String((error as { digest?: string }).digest ?? error);
  }
  return "no error";
};

describe("requirePlatformAdmin", () => {
  it("lets a platform admin through", async () => {
    const boss = await platformAdmin();
    session.id = boss.id;
    const { requirePlatformAdmin } = await load();
    expect((await requirePlatformAdmin()).id).toBe(boss.id);
  });

  it("answers anybody else with not-found, not a redirect", async () => {
    const m = await mentor();
    session.id = m.id;
    const { requirePlatformAdmin } = await load();
    expect(await digestOf(requirePlatformAdmin())).toContain("404");
  });

  it("sends a signed-out request to the login page", async () => {
    const { requirePlatformAdmin } = await load();
    expect(await digestOf(requirePlatformAdmin())).toContain("NEXT_REDIRECT");
  });

  it("refuses a removed account", async () => {
    const m = await mentor();
    session.id = m.id;
    await prisma.user.delete({ where: { id: m.id } });
    const { requirePlatformAdmin } = await load();
    expect(await digestOf(requirePlatformAdmin())).toContain("NEXT_REDIRECT");
  });
});
