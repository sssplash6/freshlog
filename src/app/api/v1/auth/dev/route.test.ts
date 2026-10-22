import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/v1/auth/dev/route";
import { userForToken } from "@/lib/api/tokens";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { mentor } from "@/test/db";

/**
 * The app's way into a local server without Google. It answers to the one rule
 * /api/dev-login does, so on any server but a developer's own it is a 404 with
 * nothing behind it. Nothing here stands in for that rule: it is the real
 * `devLoginEnabled`, steered by the environment and the request's own headers.
 */
afterEach(() => vi.unstubAllEnvs());

type HeaderMap = Record<string, string>;
const local = (init: RequestInit = {}) =>
  new Request("http://localhost:3001/api/v1/auth/dev", { ...init, headers: { host: "localhost:3001", ...init.headers } });
const post = (raw?: string, headers: HeaderMap = {}) => POST(local({ method: "POST", headers, body: raw }));
const signInAs = (email: string, headers?: HeaderMap) => post(JSON.stringify({ email }), headers);

const NOT_FOUND = { ok: false, error: "Not found." };
const NO_ACCOUNT = { ok: false, error: "No account with that email." };

describe("when dev login is off", () => {
  /**
   * A list, a sign-in as somebody who exists, as somebody who does not, and one
   * nobody can read. A server that is off gives all four the same answer, so it
   * cannot be asked who has an account.
   */
  const everyAsk = async (headers: HeaderMap = {}) => {
    const m = await mentor();
    return [
      await GET(local({ headers })),
      await signInAs(m.email, headers),
      await signInAs("nobody@example.com", headers),
      await post("{ not json", headers),
    ];
  };

  it("answers 404 when dev login is off", async () => {
    vi.stubEnv("DEV_LOGIN", "");
    for (const res of await everyAsk()) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
    expect(await prisma.apiToken.count()).toBe(0);
  });

  it("answers 404 behind a proxy that forwards a public host, though the flag is on", async () => {
    vi.stubEnv("DEV_LOGIN", "1");
    for (const res of await everyAsk({ "x-forwarded-host": "www.freshlog.net" })) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
    expect(await prisma.apiToken.count()).toBe(0);
  });
});

describe("on a server shared through a tunnel", () => {
  const KEY = "k".repeat(16);
  const tunnel = (key: string, init: RequestInit = {}) =>
    new Request(`https://abc.trycloudflare.com/api/v1/auth/dev?key=${key}`, {
      ...init,
      headers: { host: "abc.trycloudflare.com", "x-forwarded-host": "abc.trycloudflare.com" },
    });

  beforeEach(() => {
    vi.stubEnv("DEV_LOGIN", "1");
    vi.stubEnv("DEV_LOGIN_KEY", KEY);
  });

  it("lists the accounts and signs in for a request that carries the key, as /api/dev-login does", async () => {
    const m = await mentor();
    expect((await GET(tunnel(KEY))).status).toBe(200);
    const res = await POST(tunnel(KEY, { method: "POST", body: JSON.stringify({ email: m.email }) }));
    expect(res.status).toBe(200);
    expect((await userForToken((await res.json()).token))?.id).toBe(m.id);
  });

  it("answers 404 to one that carries another", async () => {
    const m = await mentor();
    const wrong = "j".repeat(16);
    const list = await GET(tunnel(wrong));
    const signIn = await POST(tunnel(wrong, { method: "POST", body: JSON.stringify({ email: m.email }) }));
    for (const res of [list, signIn]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
    expect(await prisma.apiToken.count()).toBe(0);
  });
});

describe("on a local server", () => {
  beforeEach(() => vi.stubEnv("DEV_LOGIN", "1"));

  describe("GET", () => {
    it("lists the accounts on localhost", async () => {
      const m = await mentor("Dilnoza Yusupova");
      const { accounts } = await (await GET(local())).json();
      expect(accounts).toContainEqual(expect.objectContaining({ email: m.email, name: "Dilnoza Yusupova" }));
    });

    it("lists each account by email, name, role and status, and nothing else about it", async () => {
      const m = await mentor("Dilnoza Yusupova");
      const res = await GET(local());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        accounts: [{ email: m.email, name: "Dilnoza Yusupova", role: "MENTOR", status: "ACTIVE" }],
      });
    });

    it("lists by role, then by email, the way /api/dev-login does", async () => {
      // Made in an order that neither sort gives, so only both together do.
      for (const [email, role] of [
        ["zoe@test.invalid", ROLES.MENTOR],
        ["amy@test.invalid", ROLES.MENTOR],
        ["zed@test.invalid", ROLES.ADMIN],
      ]) {
        await prisma.user.create({ data: { email, role } });
      }
      const { accounts } = await (await GET(local())).json();
      expect(accounts.map((a: { email: string }) => a.email)).toEqual(["zed@test.invalid", "amy@test.invalid", "zoe@test.invalid"]);
    });

    it("lists an account that is not active yet, with the status it waits in", async () => {
      const m = await mentor();
      await prisma.user.update({ where: { id: m.id }, data: { status: "UNASSIGNED" } });
      const { accounts } = await (await GET(local())).json();
      expect(accounts).toEqual([expect.objectContaining({ email: m.email, status: "UNASSIGNED" })]);
    });

    it("is never kept by a cache", async () => {
      expect((await GET(local())).headers.get("cache-control")).toBe("no-store");
    });
  });

  describe("POST", () => {
    it("signs in as a listed account", async () => {
      const m = await mentor("Dilnoza Yusupova");
      const { token } = await (await signInAs(m.email)).json();
      expect((await userForToken(token))?.id).toBe(m.id);
    });

    it("answers with the token and when it runs out, and is never kept by a cache", async () => {
      const m = await mentor();
      const res = await signInAs(m.email);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual(["expiresAt", "token"]);
      expect(new Date(body.expiresAt).toISOString()).toBe(body.expiresAt);
    });

    it("does not name the phone", async () => {
      const m = await mentor();
      await signInAs(m.email);
      expect((await prisma.apiToken.findFirstOrThrow()).deviceName).toBeNull();
    });

    it("reads the email the way /api/dev-login does: trimmed, and in any case", async () => {
      const m = await mentor();
      const res = await signInAs(`  ${m.email.toUpperCase()} `);
      expect(res.status).toBe(200);
      expect((await userForToken((await res.json()).token))?.id).toBe(m.id);
    });

    it("signs in as an account that is not active yet, which is how the app's waiting screens get checked", async () => {
      const m = await mentor();
      await prisma.user.update({ where: { id: m.id }, data: { status: "UNASSIGNED" } });
      const res = await signInAs(m.email);
      expect(res.status).toBe(200);
      expect((await userForToken((await res.json()).token))?.id).toBe(m.id);
    });

    it("answers 404 for an unknown email", async () => {
      const res = await signInAs("nobody@example.com");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NO_ACCOUNT);
    });

    it.each([
      ["no body", undefined],
      ["a body that is not JSON", "{ not json"],
      ["JSON that is not an object", '"someone@example.com"'],
      ["JSON null", "null"],
      ["a list", '["someone@example.com"]'],
      ["no email", "{}"],
      ["an email of null", '{"email":null}'],
      ["an email that is a number", '{"email":5}'],
      ["an email that is a list", '{"email":["someone@example.com"]}'],
      ["an email that is a filter, not an address", '{"email":{"not":""}}'],
      ["an empty email", '{"email":""}'],
      ["an email of only spaces", '{"email":"   "}'],
    ])("answers the same 404, and makes no token, for %s", async (_, raw) => {
      await mentor(); // somebody to be wrongly signed in as
      const res = await post(raw);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NO_ACCOUNT);
      expect(await prisma.apiToken.count()).toBe(0);
    });
  });
});
