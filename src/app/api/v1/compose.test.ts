import { beforeEach, describe, expect, it, vi } from "vitest";

import { issueToken, revokeToken } from "@/lib/api/tokens";
import { prisma } from "@/lib/prisma";
import { mentor } from "@/test/db";

/**
 * The routes put together with the real `getCurrentUser`, the real tokens and
 * the real database. Every route test beside this one replaces `@/lib/dal`, so
 * this is where the pieces are shown to fit.
 *
 * Only the two things a test process cannot have are stood in for: the
 * website's cookie session (`auth`) and the request that `next/headers` reads.
 * The Request a route is handed carries the same Authorization header, so the
 * route and `getCurrentUser` see one request.
 */
const session = vi.hoisted(() => ({ id: null as string | null }));
const sent = vi.hoisted(() => ({ authorization: null as string | null }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (session.id ? { user: { id: session.id } } : null),
  signIn: async () => {
    throw new Error("NEXT_REDIRECT google");
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(sent.authorization === null ? {} : { authorization: sent.authorization }),
}));

// `getCurrentUser` is wrapped in React's `cache`; fresh modules per test keep
// one test's person from answering for the next.
beforeEach(() => {
  vi.resetModules();
  session.id = null;
  sent.authorization = null;
});

const DAY_MS = 24 * 60 * 60 * 1000;
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"; // RFC 7636, appendix B
const QUERY = `redirect_uri=${encodeURIComponent("freshlog://auth")}&code_challenge=${CHALLENGE}&code_challenge_method=S256&state=s1`;

const me = async () => (await import("@/app/api/v1/me/route")).GET();

const start = async () => {
  const { GET } = await import("@/app/api/v1/auth/start/route");
  const headers: Record<string, string> = sent.authorization === null ? {} : { authorization: sent.authorization };
  return GET(new Request(`http://test/api/v1/auth/start?${QUERY}`, { headers }));
};

/** An Authorization header carrying a new token for `userId`, issued at `at`. */
const bearer = async (userId: string, at?: Date) => `Bearer ${(await issueToken(userId, null, at)).token}`;

const SIGN_IN_AGAIN = { ok: false, error: "Sign in again.", code: "unauthenticated" };

describe("/api/v1/me through the real getCurrentUser", () => {
  it("answers a live token with the person it belongs to", async () => {
    const m = await mentor();
    sent.authorization = await bearer(m.id);
    const res = await me();
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(m.id);
  });

  it("answers a revoked token with 401, even with a cookie session beside it", async () => {
    const m = await mentor();
    const { token } = await issueToken(m.id, null);
    await revokeToken(token);
    session.id = m.id;
    sent.authorization = `Bearer ${token}`;
    const res = await me();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(SIGN_IN_AGAIN);
  });

  it("answers an expired token with 401, even with a cookie session beside it", async () => {
    const m = await mentor();
    session.id = m.id;
    sent.authorization = await bearer(m.id, new Date(Date.now() - 91 * DAY_MS));
    const res = await me();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(SIGN_IN_AGAIN);
  });

  it("answers a header that isn't a Bearer token with 401, even with a cookie session beside it", async () => {
    const m = await mentor();
    session.id = m.id;
    sent.authorization = "Basic dXNlcjpwYXNzd29yZA==";
    expect((await me()).status).toBe(401);
  });

  it("still answers the website's cookie alone, as the web does", async () => {
    const m = await mentor();
    session.id = m.id;
    const res = await me();
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(m.id);
  });

  it("answers a request with neither with 401", async () => {
    const res = await me();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(SIGN_IN_AGAIN);
  });
});

describe("/api/v1/auth/start through the real getCurrentUser", () => {
  it("makes a code for the website's cookie with no Authorization header, in the Continue page", async () => {
    const m = await mentor();
    session.id = m.id;
    const res = await start();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect((await prisma.apiSignInCode.findFirstOrThrow()).userId).toBe(m.id);
    expect(await prisma.apiSignInCode.count()).toBe(1);
  });

  it("sends the cookie with a live token beside it to Google, and makes no code", async () => {
    const m = await mentor();
    session.id = m.id;
    sent.authorization = await bearer(m.id);
    await expect(start()).rejects.toThrow("NEXT_REDIRECT google");
    expect(await prisma.apiSignInCode.count()).toBe(0);
  });

  it("sends a live token alone to Google, and makes no code", async () => {
    const m = await mentor();
    sent.authorization = await bearer(m.id);
    await expect(start()).rejects.toThrow("NEXT_REDIRECT google");
    expect(await prisma.apiSignInCode.count()).toBe(0);
  });

  it("sends a request with neither to Google, and makes no code", async () => {
    await expect(start()).rejects.toThrow("NEXT_REDIRECT google");
    expect(await prisma.apiSignInCode.count()).toBe(0);
  });
});
