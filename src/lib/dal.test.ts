import { beforeEach, describe, expect, it, vi } from "vitest";

import { issueToken, revokeToken } from "@/lib/api/tokens";
import { prisma } from "@/lib/prisma";
import { mentor, platformAdmin } from "@/test/db";

const session = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (session.id ? { user: { id: session.id } } : null),
}));

// `getCurrentUser` reads the request's Authorization header; a test sets it here.
const request = vi.hoisted(() => ({ authorization: null as string | null }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(request.authorization ? { authorization: request.authorization } : {}),
}));

// `getCurrentUser` is wrapped in React's `cache`; a fresh module per test keeps
// one test's user from answering for the next.
beforeEach(() => {
  vi.resetModules();
  session.id = null;
  request.authorization = null;
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

describe("getCurrentUser with a bearer token", () => {
  it("with no Authorization header returns the cookie's user", async () => {
    const m = await mentor();
    session.id = m.id;
    const { getCurrentUser } = await load();
    expect((await getCurrentUser())?.id).toBe(m.id);
  });

  it("returns a bearer token's user with no cookie", async () => {
    const m = await mentor();
    request.authorization = `Bearer ${(await issueToken(m.id, null)).token}`;
    const { getCurrentUser } = await load();
    expect((await getCurrentUser())?.id).toBe(m.id);
  });

  it("an invalid bearer token answers null even with a cookie user", async () => {
    const m = await mentor();
    session.id = m.id;
    request.authorization = "Bearer not-a-token";
    const { getCurrentUser } = await load();
    expect(await getCurrentUser()).toBeNull();
  });

  it("requireUser sends a revoked token's request to the login page", async () => {
    const m = await mentor();
    const { token } = await issueToken(m.id, null);
    await revokeToken(token);
    request.authorization = `Bearer ${token}`;
    const { requireUser } = await load();
    expect(await digestOf(requireUser())).toContain("NEXT_REDIRECT");
  });

  // A header that is present but isn't "Bearer <token>" is still a credential the
  // request carries, so it too is judged alone and never falls back to the cookie.
  it("a header that isn't a Bearer token answers null even with a cookie user", async () => {
    const m = await mentor();
    session.id = m.id;
    request.authorization = "Basic bWF4OnNlY3JldA==";
    const { getCurrentUser } = await load();
    expect(await getCurrentUser()).toBeNull();
  });
});
