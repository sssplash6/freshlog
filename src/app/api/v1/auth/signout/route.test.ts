import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/v1/auth/signout/route";
import { issueToken, userForToken } from "@/lib/api/tokens";
import { prisma } from "@/lib/prisma";
import { DAY, mentor } from "@/test/db";

/**
 * Signing out ends a sign-in, so it asks for no session and tells the caller
 * nothing: a token that was never good, or is already gone, leaves the app in
 * the same place as one that just ended.
 *
 * Nothing here stands in for the session (`@/lib/dal` is not mocked), so the
 * route cannot be asking for one: outside a request there is nobody to ask.
 */
const signOut = (authorization?: string) =>
  POST(new Request("http://test/api/v1/auth/signout", {
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
  }));

describe("POST /api/v1/auth/signout", () => {
  it("revokes the token it is sent", async () => {
    const m = await mentor();
    const { token } = await issueToken(m.id, null);
    const res = await POST(new Request("http://test", { method: "POST", headers: { authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(204);
    expect(await userForToken(token)).toBeNull();
  });

  it("answers 204 with no token", async () => {
    expect((await POST(new Request("http://test", { method: "POST" }))).status).toBe(204);
  });
});

describe("ending a sign-in", () => {
  it("ends the token it was sent and no other, not even the same person's", async () => {
    const m = await mentor();
    const phone = await issueToken(m.id, "iPhone");
    const tablet = await issueToken(m.id, "iPad");
    const stranger = await issueToken((await mentor("Someone Else")).id, null);

    await signOut(`Bearer ${phone.token}`);

    expect(await userForToken(phone.token)).toBeNull();
    expect((await userForToken(tablet.token))?.id).toBe(m.id);
    expect(await userForToken(stranger.token)).not.toBeNull();
  });

  it("keeps the row, with the time it ended, so the sign-in can still be told apart from one that never was", async () => {
    const m = await mentor();
    const { token } = await issueToken(m.id, "iPhone");
    await signOut(`Bearer ${token}`);
    const row = await prisma.apiToken.findFirstOrThrow();
    expect(row.revokedAt).not.toBeNull();
    expect(row.deviceName).toBe("iPhone");
  });

  it("reads the word Bearer in any case, as the rest of the API does", async () => {
    const m = await mentor();
    const { token } = await issueToken(m.id, null);
    expect((await signOut(`bearer ${token}`)).status).toBe(204);
    expect(await userForToken(token)).toBeNull();
  });

  it("does not undo anything for a token that is already ended", async () => {
    const m = await mentor();
    const { token } = await issueToken(m.id, null);
    await signOut(`Bearer ${token}`);
    const first = (await prisma.apiToken.findFirstOrThrow()).revokedAt;

    expect((await signOut(`Bearer ${token}`)).status).toBe(204);
    expect((await prisma.apiToken.findFirstOrThrow()).revokedAt).toEqual(first);
    expect(await userForToken(token)).toBeNull();
  });
});

describe("whatever it is sent", () => {
  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["another scheme", "Basic dXNlcjpwYXNz"],
    ["the scheme alone", "Bearer"],
    ["the scheme and a space", "Bearer "],
    ["two tokens", "Bearer one two"],
    ["no scheme", "abc123"],
    ["a token nobody was given", "Bearer not-a-token-we-issued"],
  ])("answers 204 for %s, and leaves every real token alone", async (_name, header) => {
    const m = await mentor();
    const { token } = await issueToken(m.id, null);

    const res = await signOut(header);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await prisma.apiToken.count({ where: { revokedAt: null } })).toBe(1);
    expect((await userForToken(token))?.id).toBe(m.id);
  });

  it("answers 204 for a token that has run out", async () => {
    const m = await mentor();
    const { token } = await issueToken(m.id, null, new Date(Date.now() - 100 * DAY));
    expect((await signOut(`Bearer ${token}`)).status).toBe(204);
  });

  it("answers 204 and keeps nothing for a cache", async () => {
    expect((await signOut()).headers.get("cache-control")).toBe("no-store");
  });
});
