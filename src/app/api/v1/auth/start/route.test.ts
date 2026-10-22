import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { redeemSignInCode } from "@/lib/api/tokens";
import { ROLES, USER_STATUS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { mentor } from "@/test/db";

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"; // RFC 7636, appendix B
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

/**
 * `start` is where the app's sign-in begins and where Google sends the person
 * back to. A code leaves it only for a person the website has signed in (a
 * request that carries an Authorization header is not one), only for an address
 * on the list, only when the request is whole, and only inside a page the person
 * taps: it never rides a redirect.
 *
 * `getCurrentUser` is replaced by one that finds whoever `actor` names, however
 * the request asks. The real one is bearer-first (src/lib/dal.ts), so a request
 * with a valid token finds a person too, and these tests show what the route
 * does with that person.
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

/** `start()` with an Authorization header, whatever it holds. */
const startWithHeader = (authorization: string) =>
  GET(new Request(`http://test/api/v1/auth/start?${QUERY}`, { headers: { authorization } }));

/** What the Continue page must send, written out so a change to the route's headers has to change a test. */
const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

const NAMED_REFERENCES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * Reads character references the way a browser does: each one once, in a single
 * pass. It is written here and not shared with the route, so a page that escapes
 * wrongly cannot agree with its own reader.
 */
const unescapeHtml = (text: string) =>
  text.replace(/&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g, (_, hex, decimal, name) =>
    name ? NAMED_REFERENCES[name] : String.fromCodePoint(hex ? parseInt(hex, 16) : Number(decimal))
  );

/** The address of every link on the page, as written, before any character reference is read. */
const hrefs = (html: string) => [...html.matchAll(/<a\b[^>]*?\bhref="([^"]*)"/g)].map((m) => m[1]);

/** What each <strong> on the page says, as the person reads it. */
const strongs = (html: string) => [...html.matchAll(/<strong>([\s\S]*?)<\/strong>/g)].map((m) => unescapeHtml(m[1]));

/** What the page says directly beneath the name, as the person reads it. */
const beneathName = (html: string) => {
  const match = /<\/strong><span>([\s\S]*?)<\/span>/.exec(html);
  return match ? unescapeHtml(match[1]) : null;
};

const count = (text: string, part: string) => text.split(part).length - 1;

/**
 * Checks that `res` is the Continue page, and gives back its text and the one
 * address its link goes to, as a browser would read it.
 */
async function continuePage(res: Response) {
  expect(res.status).toBe(200);
  for (const [name, value] of Object.entries(PAGE_HEADERS)) expect(res.headers.get(name), name).toBe(value);
  const html = await res.text();
  const written = hrefs(html);
  expect(written, "the links on the page").toHaveLength(1);
  return { html, link: unescapeHtml(written[0]) };
}

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

  it("hands a signed-in person a code for the app, in a page they tap through", async () => {
    const m = await mentor();
    actor.value = { id: m.id };
    const { link } = await continuePage(await start());
    expect(link).toMatch(/^freshlog:\/\/auth\?code=[\w-]+&state=s1$/);
    const back = new URL(link);
    expect(back.protocol).toBe("freshlog:");
    expect(back.searchParams.get("state")).toBe("s1");
    expect(await prisma.apiSignInCode.count()).toBe(1);
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

    const { link } = await continuePage(await start(`${QUERY}&redirect_uri=${evil}`));
    expect(link).toMatch(/^freshlog:\/\/auth\?code=/);
    expect(await prisma.apiSignInCode.count()).toBe(1);
  });

  it("may be an Expo address only when Expo redirects are allowed", async () => {
    await signInAs();
    const expo = "exp://192.168.1.5:8081/--/auth";

    vi.stubEnv("API_ALLOW_EXPO_REDIRECTS", "");
    expect((await startWith("redirect_uri", expo)).status).toBe(400);
    expect(await prisma.apiSignInCode.count()).toBe(0);

    vi.stubEnv("API_ALLOW_EXPO_REDIRECTS", "1");
    const { link } = await continuePage(await startWith("redirect_uri", expo));
    const back = new URL(link);
    expect(back.protocol).toBe("exp:");
    expect(link).toMatch(/^exp:\/\/192\.168\.1\.5:8081\/--\/auth\?code=/);
    expect(await prisma.apiSignInCode.count()).toBe(1);
    expect(await redeemSignInCode({ code: back.searchParams.get("code")!, verifier: VERIFIER, redirectUri: expo }))
      .toHaveProperty("userId");
  });

  it("gets the code after a ? when it has no query, and after an & when it has one", async () => {
    await signInAs();
    const plain = await continuePage(await start());
    expect(plain.link).toMatch(/^freshlog:\/\/auth\?code=[\w-]+&state=s1$/);

    const withQuery = await continuePage(await startWith("redirect_uri", "freshlog://auth?from=signin"));
    expect(withQuery.link).toMatch(/^freshlog:\/\/auth\?from=signin&code=[\w-]+&state=s1$/);
    expect(await prisma.apiSignInCode.count()).toBe(2);
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
    const { link } = await continuePage(await startWith("redirect_uri", redirectUri));
    const code = new URL(link).searchParams.get("code")!;
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
    await continuePage(await start());
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
    const { link } = await continuePage(await startWith("state", longest));
    expect(new URL(link).searchParams.get("state")).toBe(longest);
    expect(new URL(link).searchParams.get("code")).not.toBeNull();

    const tooLong = await startWith("state", "s".repeat(201));
    expect(tooLong.status).toBe(303);
    expect(tooLong.headers.get("location")).toBe("freshlog://auth?error=invalid_request");
    expect(await prisma.apiSignInCode.count()).toBe(1);
  });

  it("comes back to the app exactly as it was sent, however odd", async () => {
    await signInAs();
    const state = "a b&c=d/é?#😀%41";
    const { link } = await continuePage(await startWith("state", state));
    expect(link).toContain(`&state=${encodeURIComponent(state)}`);
    expect(new URL(link).searchParams.get("state")).toBe(state);
    expect(new URL(link).searchParams.get("c")).toBeNull();
    expect(await prisma.apiSignInCode.count()).toBe(1);
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

describe("the page a signed-in person is shown", () => {
  it("names the account it is signing in, the name first and the email beneath it", async () => {
    const user = await prisma.user.create({ data: { email: "ada@test.invalid", name: "Ada Lovelace", role: ROLES.MENTOR } });
    actor.value = { id: user.id };
    const { html } = await continuePage(await start());
    expect(strongs(html)).toEqual(["Ada Lovelace"]);
    expect(beneathName(html)).toBe("ada@test.invalid");
  });

  it("names an account that has no name by its email alone", async () => {
    const user = await prisma.user.create({ data: { email: "nameless@test.invalid", name: null, role: ROLES.MENTOR } });
    actor.value = { id: user.id };
    const { html } = await continuePage(await start());
    expect(strongs(html)).toEqual(["nameless@test.invalid"]);
    expect(beneathName(html)).toBeNull();
    expect(count(html, "nameless@test.invalid")).toBe(1);
  });

  it("treats a name that is only spaces as no name, the way a Google sign-in can leave one", async () => {
    const user = await prisma.user.create({ data: { email: "blank@test.invalid", name: "   ", role: ROLES.MENTOR } });
    actor.value = { id: user.id };
    const { html } = await continuePage(await start());
    expect(strongs(html)).toEqual(["blank@test.invalid"]);
    expect(count(html, "blank@test.invalid")).toBe(1);
  });

  it("says what it is for, and warns anyone who did not start from the app", async () => {
    await signInAs();
    const { html } = await continuePage(await start());
    const note = "Only continue if you started signing in from the freshlog app.";
    expect(html).toContain("<title>Sign in to the freshlog app</title>");
    expect(html).toContain("<h1>Sign in to the freshlog app</h1>");
    expect(html).toMatch(/<a [^>]*>Continue<\/a>/);
    expect(html.indexOf(note)).toBeGreaterThan(html.indexOf("Continue</a>"));
  });

  it("is laid out for a phone's width and read as UTF-8", async () => {
    await signInAs();
    const { html } = await continuePage(await start());
    expect(html).toMatch(/<meta charset="utf-8">/i);
    expect(html).toMatch(/<meta name="viewport" content="[^"]*width=device-width/);
  });

  it("holds a name, an email and an address that contain markup as plain text, so none of it adds to the page", async () => {
    await signInAs();
    const plain = await continuePage(await start());

    // Text that is already a character reference (`&amp;`, `&lt;`) must stay text too: a browser would read it as `&` and `<`.
    const user = await prisma.user.create({ data: { email: `"><i>@test.invalid`, name: `<b>"x"&'&amp;`, role: ROLES.MENTOR } });
    actor.value = { id: user.id };
    const redirectUri = `freshlog://auth?a="><script>alert(1)</script>&b='<&amp;&lt;`;
    const hostile = await continuePage(await startWith("redirect_uri", redirectUri));

    // What the person reads and what the app receives is exactly what was stored and sent...
    expect(strongs(hostile.html)).toEqual([`<b>"x"&'&amp;`]);
    expect(beneathName(hostile.html)).toBe(`"><i>@test.invalid`);
    expect(hostile.link.startsWith(`${redirectUri}&code=`)).toBe(true);
    expect(hostile.link.endsWith("&state=s1")).toBe(true);

    // ...and none of it is markup: the page has as many tags, brackets and quotes as one with nothing odd in it.
    for (const mark of ["<", ">", '"', "'"]) expect(count(hostile.html, mark), mark).toBe(count(plain.html, mark));
    for (const injected of ["<script", "<b>", "<i>"]) expect(hostile.html, injected).not.toContain(injected);
  });

  it("holds an email that contains markup as plain text when it stands alone, too", async () => {
    const user = await prisma.user.create({ data: { email: `"><i>@test.invalid`, name: null, role: ROLES.MENTOR } });
    actor.value = { id: user.id };
    const { html } = await continuePage(await start());
    expect(strongs(html)).toEqual([`"><i>@test.invalid`]);
    expect(html).not.toContain("<i>");
  });

  it("holds nothing that moves on without a tap: no script, refresh, form, frame, image or second address", async () => {
    await signInAs();
    const { html } = await continuePage(await start());
    for (const part of ["<script", "http-equiv", "<form", "<iframe", "<img", "<link", "<object", "<embed", "<base", " src=", " onload", " onclick"]) {
      expect(html.toLowerCase(), part).not.toContain(part);
    }
    // The code is in the one link and nowhere else on the page.
    expect(count(html, "code=")).toBe(1);
    expect(count(html, "freshlog://")).toBe(1);
  });
});

describe("a request that carries an Authorization header", () => {
  // The sign-in sheet never sends one. A token is how the app asks for data, not how a person
  // signs in, and a token that could be traded for a code could be traded for another token.
  it.each([
    ["a Bearer token", "Bearer 4Zb2kQ0vXr9sTn7LpWc1Yd5JhGfEa8UmIoKxNqBtRzM"],
    ["Basic credentials", "Basic dXNlcjpwYXNzd29yZA=="],
    ["an empty value", ""],
  ])("has no website session, so with %s it is sent to Google and never given a code", async (_, authorization) => {
    await signInAs();
    await expect(startWithHeader(authorization)).rejects.toThrow("NEXT_REDIRECT google");
    expect(await prisma.apiSignInCode.count()).toBe(0);
    expect(signedIn.calls).toEqual([["google", { redirectTo: `/api/v1/auth/start?${QUERY}` }]]);
  });

  it("still has its redirect and its request checked before anything else", async () => {
    await signInAs();
    const bearer = { authorization: "Bearer 4Zb2kQ0vXr9sTn7LpWc1Yd5JhGfEa8UmIoKxNqBtRzM" };
    const ask = (query: string) => GET(new Request(`http://test/api/v1/auth/start?${query}`, { headers: bearer }));

    const notTheApps = await ask(QUERY.replace(encodeURIComponent("freshlog://auth"), encodeURIComponent("https://evil.example")));
    expect(notTheApps.status).toBe(400);
    expect(await notTheApps.text()).toBe("This sign-in link isn't for freshlog.");

    const unfinished = await ask(QUERY.replace(CHALLENGE, "short"));
    expect(unfinished.headers.get("location")).toBe("freshlog://auth?error=invalid_request&state=s1");

    expect(signedIn.calls).toEqual([]);
    expect(await prisma.apiSignInCode.count()).toBe(0);
  });
});
