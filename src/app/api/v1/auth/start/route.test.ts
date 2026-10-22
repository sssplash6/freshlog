import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { redeemSignInCode } from "@/lib/api/tokens";
import { ROLES, USER_STATUS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { mentor } from "@/test/db";

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"; // RFC 7636, appendix B
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

/**
 * `start` is where the app's sign-in begins and where Google sends the person
 * back to. A code leaves it only for a signed-in person, only for an address on
 * the list, and only when the request is whole.
 *
 * `signIn` is replaced by one that records what it was asked and throws, the way
 * the real one does when it redirects (Next's NEXT_REDIRECT).
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
const signedIn = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));
vi.mock("@/lib/auth", () => ({
  signIn: async (...args: unknown[]) => {
    signedIn.calls.push(args);
    throw new Error("NEXT_REDIRECT google");
  },
}));

const { GET } = await import("@/app/api/v1/auth/start/route");

beforeEach(() => {
  actor.value = null;
  signedIn.calls = [];
});
afterEach(() => vi.unstubAllEnvs());

const QUERY = `redirect_uri=${encodeURIComponent("freshlog://auth")}&code_challenge=${CHALLENGE}&code_challenge_method=S256&state=s1`;
const start = (query = QUERY) => GET(new Request(`http://test/api/v1/auth/start?${query}`));

/** QUERY with one parameter changed, or left out when `value` is null. */
const startWith = (name: string, value: string | null) => {
  const params = new URLSearchParams(QUERY);
  if (value === null) params.delete(name);
  else params.set(name, value);
  return start(params.toString());
};

const signInAs = async () => {
  const m = await mentor();
  actor.value = { id: m.id };
  return m;
};

describe("GET /api/v1/auth/start", () => {
  it("refuses a redirect that isn't the app's", async () => {
    const res = await start(QUERY.replace(encodeURIComponent("freshlog://auth"), encodeURIComponent("https://evil.example")));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("This sign-in link isn't for freshlog.");
  });

  it("sends a signed-out visitor to Google, and back here afterwards", async () => {
    await expect(start()).rejects.toThrow("NEXT_REDIRECT google");
    expect(signedIn.calls[0]).toEqual(["google", { redirectTo: `/api/v1/auth/start?${QUERY}` }]);
  });

  it("hands a signed-in person a code for the app", async () => {
    const m = await mentor();
    actor.value = { id: m.id };
    const res = await start();
    expect(res.status).toBe(303);
    const back = new URL(res.headers.get("location")!);
    expect(back.protocol).toBe("freshlog:");
    expect(back.searchParams.get("state")).toBe("s1");
    expect(await redeemSignInCode({ code: back.searchParams.get("code")!, verifier: VERIFIER, redirectUri: "freshlog://auth" }))
      .toEqual({ userId: m.id });
  });

  it("answers a malformed challenge with an error the app can read", async () => {
    const res = await start(QUERY.replace(CHALLENGE, "short"));
    expect(res.headers.get("location")).toBe("freshlog://auth?error=invalid_request&state=s1");
  });
});

describe("the redirect", () => {
  it("is refused when it is not the app's, signed in or not, and no code is made", async () => {
    for (const bad of ["https://evil.example", "http://localhost:3000/auth", "javascript:alert(1)", "//evil.example", "evil"]) {
      actor.value = null;
      expect((await startWith("redirect_uri", bad)).status, bad).toBe(400);
      await signInAs();
      const res = await startWith("redirect_uri", bad);
      expect(res.status, bad).toBe(400);
      expect(res.headers.get("location"), bad).toBeNull();
    }
    expect(await prisma.apiSignInCode.count()).toBe(0);
  });

  it("is refused when there is none, or it is empty", async () => {
    await signInAs();
    expect((await startWith("redirect_uri", null)).status).toBe(400);
    expect((await startWith("redirect_uri", "")).status).toBe(400);
    expect(await prisma.apiSignInCode.count()).toBe(0);
  });

  it("is refused before the sign-in goes anywhere, so a refused link never sees Google", async () => {
    expect((await startWith("redirect_uri", "https://evil.example")).status).toBe(400);
    expect(signedIn.calls).toEqual([]);
  });

  it("is refused with 400 even when the rest of the request is wrong too, and is never given an error to read", async () => {
    await signInAs();
    const params = new URLSearchParams({ redirect_uri: "https://evil.example", code_challenge: "short", code_challenge_method: "plain" });
    const res = await start(params.toString());
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("is refused when it has a line break in it, rather than put one in a header", async () => {
    await signInAs();
    const res = await startWith("redirect_uri", "freshlog://auth\r\nSet-Cookie: a=b");
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("is the one that was checked when the parameter is sent twice", async () => {
    await signInAs();
    const evil = encodeURIComponent("https://evil.example");
    expect((await start(`redirect_uri=${evil}&${QUERY}`)).status).toBe(400);

    const res = await start(`${QUERY}&redirect_uri=${evil}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^freshlog:\/\/auth\?code=/);
  });

  it("may be an Expo address only when Expo redirects are allowed", async () => {
    await signInAs();
    const expo = "exp://192.168.1.5:8081/--/auth";

    vi.stubEnv("API_ALLOW_EXPO_REDIRECTS", "");
    expect((await startWith("redirect_uri", expo)).status).toBe(400);
    expect(await prisma.apiSignInCode.count()).toBe(0);

    vi.stubEnv("API_ALLOW_EXPO_REDIRECTS", "1");
    const res = await startWith("redirect_uri", expo);
    expect(res.status).toBe(303);
    const back = new URL(res.headers.get("location")!);
    expect(back.protocol).toBe("exp:");
    expect(res.headers.get("location")).toMatch(/^exp:\/\/192\.168\.1\.5:8081\/--\/auth\?code=/);
    expect(await redeemSignInCode({ code: back.searchParams.get("code")!, verifier: VERIFIER, redirectUri: expo }))
      .toHaveProperty("userId");
  });

  it("gets the code after a ? when it has no query, and after an & when it has one", async () => {
    await signInAs();
    const plain = await start();
    expect(plain.headers.get("location")).toMatch(/^freshlog:\/\/auth\?code=[\w-]+&state=s1$/);

    const withQuery = await startWith("redirect_uri", "freshlog://auth?from=signin");
    expect(withQuery.headers.get("location")).toMatch(/^freshlog:\/\/auth\?from=signin&code=[\w-]+&state=s1$/);
  });

  it("gets its error after an & too when it already has a query", async () => {
    const res = await start(new URLSearchParams({
      redirect_uri: "freshlog://auth?from=signin", code_challenge: "short", code_challenge_method: "S256", state: "s1",
    }).toString());
    expect(res.headers.get("location")).toBe("freshlog://auth?from=signin&error=invalid_request&state=s1");
  });

  it("is the one the code is made for, whole, query included", async () => {
    await signInAs();
    const redirectUri = "freshlog://auth?from=signin";
    const res = await startWith("redirect_uri", redirectUri);
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
    expect((await prisma.apiSignInCode.findFirstOrThrow()).redirectUri).toBe(redirectUri);
    expect(await redeemSignInCode({ code, verifier: VERIFIER, redirectUri })).toHaveProperty("userId");
  });
});

describe("the code", () => {
  it("belongs to the person signed in, bound to the challenge and redirect the app sent, for two minutes", async () => {
    const m = await signInAs();
    const before = Date.now();
    await start();
    const row = await prisma.apiSignInCode.findFirstOrThrow();
    expect(row.userId).toBe(m.id);
    expect(row.challenge).toBe(CHALLENGE);
    expect(row.redirectUri).toBe("freshlog://auth");
    expect(row.expiresAt.getTime() - before).toBeGreaterThan(110_000);
    expect(row.expiresAt.getTime() - before).toBeLessThan(130_000);
  });

  it("is made once for each visit", async () => {
    await signInAs();
    await start();
    await start();
    expect(await prisma.apiSignInCode.count()).toBe(2);
  });

  it("is not made for a signed-out visitor, who is sent to Google instead", async () => {
    await expect(start()).rejects.toThrow("NEXT_REDIRECT google");
    expect(await prisma.apiSignInCode.count()).toBe(0);
  });

  it("is never kept by a cache", async () => {
    await signInAs();
    expect((await start()).headers.get("cache-control")).toBe("no-store");
    expect((await startWith("code_challenge", "short")).headers.get("cache-control")).toBe("no-store");
    expect((await startWith("redirect_uri", "https://evil.example")).headers.get("cache-control")).toBe("no-store");
  });

  it("is made for an unapproved person too, who learns what they wait for from /me", async () => {
    const pending = await prisma.user.create({ data: { email: "pending@test.invalid", role: ROLES.STUDENT, status: USER_STATUS.PENDING } });
    actor.value = { id: pending.id };
    expect((await start()).status).toBe(303);
    expect((await prisma.apiSignInCode.findFirstOrThrow()).userId).toBe(pending.id);
  });
});

describe("the challenge", () => {
  it("must use the S256 method, spelled exactly, and be there", async () => {
    for (const method of ["plain", "s256", "S512", "", null]) {
      actor.value = null;
      const signedOut = await startWith("code_challenge_method", method);
      expect(signedOut.status, String(method)).toBe(303);
      expect(signedOut.headers.get("location"), String(method)).toBe("freshlog://auth?error=invalid_request&state=s1");

      await signInAs();
      const res = await startWith("code_challenge_method", method);
      expect(res.headers.get("location"), String(method)).toBe("freshlog://auth?error=invalid_request&state=s1");
    }
    expect(await prisma.apiSignInCode.count()).toBe(0);
    expect(signedIn.calls).toEqual([]);
  });

  it("must be 43 base64url characters, and be there", async () => {
    const bad = ["", "short", CHALLENGE.slice(1), CHALLENGE + "A", CHALLENGE.slice(0, 42) + "+", CHALLENGE.slice(0, 42) + "/", CHALLENGE.slice(0, 42) + "=", null];
    for (const challenge of bad) {
      actor.value = null;
      const signedOut = await startWith("code_challenge", challenge);
      expect(signedOut.headers.get("location"), String(challenge)).toBe("freshlog://auth?error=invalid_request&state=s1");

      await signInAs();
      const res = await startWith("code_challenge", challenge);
      expect(res.status, String(challenge)).toBe(303);
      expect(res.headers.get("location"), String(challenge)).toBe("freshlog://auth?error=invalid_request&state=s1");
    }
    expect(await prisma.apiSignInCode.count()).toBe(0);
    expect(signedIn.calls).toEqual([]);
  });

  it("is checked before a signed-out visitor is sent to Google, so a request that cannot work never leaves", async () => {
    const res = await startWith("code_challenge", "short");
    expect(res.status).toBe(303);
    expect(signedIn.calls).toEqual([]);
  });
});

describe("the state", () => {
  it("must be there, or the app gets an error with no state in it", async () => {
    await signInAs();
    for (const state of [null, ""]) {
      const res = await startWith("state", state);
      expect(res.status, String(state)).toBe(303);
      expect(res.headers.get("location"), String(state)).toBe("freshlog://auth?error=invalid_request");
    }
    expect(await prisma.apiSignInCode.count()).toBe(0);
    expect(signedIn.calls).toEqual([]);
  });

  it("may be 200 characters but not 201, and is not repeated back when it is too long", async () => {
    await signInAs();
    const longest = "s".repeat(200);
    const ok = await startWith("state", longest);
    expect(new URL(ok.headers.get("location")!).searchParams.get("state")).toBe(longest);
    expect(new URL(ok.headers.get("location")!).searchParams.get("code")).not.toBeNull();

    const tooLong = await startWith("state", "s".repeat(201));
    expect(tooLong.status).toBe(303);
    expect(tooLong.headers.get("location")).toBe("freshlog://auth?error=invalid_request");
    expect(await prisma.apiSignInCode.count()).toBe(1);
  });

  it("comes back to the app exactly as it was sent, however odd", async () => {
    await signInAs();
    const state = "a b&c=d/é?#😀%41";
    const res = await startWith("state", state);
    const location = res.headers.get("location")!;
    expect(location).toContain(`&state=${encodeURIComponent(state)}`);
    expect(new URL(location).searchParams.get("state")).toBe(state);
    expect(new URL(location).searchParams.get("c")).toBeNull();
  });

  it("comes back with the error exactly as it was sent too", async () => {
    const state = "a b&c=d/é?#😀%41";
    const res = await start(new URLSearchParams({
      redirect_uri: "freshlog://auth", code_challenge: "short", code_challenge_method: "S256", state,
    }).toString());
    const location = res.headers.get("location")!;
    expect(location).toBe(`freshlog://auth?error=invalid_request&state=${encodeURIComponent(state)}`);
    expect(new URL(location).searchParams.get("state")).toBe(state);
  });

  it("goes to Google and comes back here carrying the same state, whatever is in it", async () => {
    const state = "a b&c=d/é?#😀%41";
    const query = new URLSearchParams(QUERY);
    query.set("state", state);
    await expect(start(query.toString())).rejects.toThrow("NEXT_REDIRECT google");

    const [provider, options] = signedIn.calls[0] as [string, { redirectTo: string }];
    expect(provider).toBe("google");
    expect(options.redirectTo.startsWith("/api/v1/auth/start?")).toBe(true);
    const back = new URL(options.redirectTo, "http://test");
    expect(back.pathname).toBe("/api/v1/auth/start");
    expect(back.searchParams.get("state")).toBe(state);
    expect(back.searchParams.get("redirect_uri")).toBe("freshlog://auth");
    expect(back.searchParams.get("code_challenge")).toBe(CHALLENGE);
  });
});

describe("the way back from Google", () => {
  it("is a path on this site, never an address, so Auth.js will take it", async () => {
    await expect(start()).rejects.toThrow("NEXT_REDIRECT google");
    const [, options] = signedIn.calls[0] as [string, { redirectTo: string }];
    expect(options.redirectTo.startsWith("/")).toBe(true);
    expect(options.redirectTo.startsWith("//")).toBe(false);
    expect(options.redirectTo).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
  });

  it("is the same wherever the request says this site lives", async () => {
    await expect(
      GET(new Request(`https://www.freshlog.net/api/v1/auth/start?${QUERY}`))
    ).rejects.toThrow("NEXT_REDIRECT google");
    expect(signedIn.calls[0]).toEqual(["google", { redirectTo: `/api/v1/auth/start?${QUERY}` }]);
  });
});
