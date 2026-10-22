import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { DAY, mentor } from "@/test/db";
import {
  bearerFrom, CODE_FAILED, issueSignInCode, issueToken, redeemSignInCode, revokeToken, userForToken,
} from "@/lib/api/tokens";

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"; // RFC 7636, appendix B
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const APP = "freshlog://auth";
const T0 = new Date("2026-10-22T09:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("bearer tokens", () => {
  it("finds the user a token was issued for, for 90 days", async () => {
    const m = await mentor();
    const { token, expiresAt } = await issueToken(m.id, "iPhone", T0);
    expect((await userForToken(token, T0))?.id).toBe(m.id);
    expect(expiresAt).toEqual(at(90 * DAY));
  });

  it("stores only the token's SHA-256", async () => {
    const m = await mentor();
    const { token } = await issueToken(m.id, null, T0);
    const row = await prisma.apiToken.findFirstOrThrow();
    expect(row.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("finds nobody for a revoked token", async () => {
    const m = await mentor();
    const { token } = await issueToken(m.id, null, T0);
    await revokeToken(token);
    expect(await userForToken(token, T0)).toBeNull();
  });

  it("finds nobody for an expired token", async () => {
    const m = await mentor();
    const { token } = await issueToken(m.id, null, T0);
    expect(await userForToken(token, at(91 * DAY))).toBeNull();
  });

  it("pushes the expiry out when used more than a day after its last use", async () => {
    const m = await mentor();
    const { token } = await issueToken(m.id, null, T0);
    await userForToken(token, at(2 * DAY));
    const row = await prisma.apiToken.findFirstOrThrow();
    expect(row.expiresAt).toEqual(at(92 * DAY));
  });

  it("issuing a token clears the tokens that have expired or been ended, and keeps live ones", async () => {
    const m = await mentor();
    await issueToken(m.id, null, T0);                                    // expires at 90 days
    const ended = await issueToken(m.id, null, at(DAY));
    await revokeToken(ended.token);
    const live = await issueToken(m.id, null, at(2 * DAY));              // expires at 92 days
    await issueToken(m.id, null, at(91 * DAY));
    expect(await prisma.apiToken.count()).toBe(2);
    expect(await userForToken(live.token, at(91 * DAY))).not.toBeNull();
  });

  it("issuing a token clears other people's finished tokens too", async () => {
    const [a, b] = [await mentor(), await mentor()];
    await issueToken(a.id, null, T0);
    await issueToken(b.id, null, at(91 * DAY));
    expect((await prisma.apiToken.findMany()).map((row) => row.userId)).toEqual([b.id]);
  });

  it("reads only a well-formed Bearer header", () => {
    expect(bearerFrom(null)).toBeUndefined();
    expect(bearerFrom("Bearer abc123")).toBe("abc123");
    expect(bearerFrom("Basic abc123")).toBeNull();
    expect(bearerFrom("Bearer ")).toBeNull();
  });
});

describe("sign-in codes", () => {
  it("redeem once, with the verifier their challenge came from", async () => {
    const m = await mentor();
    const code = await issueSignInCode(m.id, CHALLENGE, APP, T0);
    expect(await redeemSignInCode({ code, verifier: VERIFIER, redirectUri: APP }, T0)).toEqual({ userId: m.id });
    expect(await redeemSignInCode({ code, verifier: VERIFIER, redirectUri: APP }, T0)).toEqual({ error: CODE_FAILED });
  });

  it("refuse another verifier, and are used up by it", async () => {
    const m = await mentor();
    const code = await issueSignInCode(m.id, CHALLENGE, APP, T0);
    expect(await redeemSignInCode({ code, verifier: "x".repeat(43), redirectUri: APP }, T0)).toEqual({ error: CODE_FAILED });
    expect(await redeemSignInCode({ code, verifier: VERIFIER, redirectUri: APP }, T0)).toEqual({ error: CODE_FAILED });
  });

  it("refuse a code older than two minutes", async () => {
    const m = await mentor();
    const code = await issueSignInCode(m.id, CHALLENGE, APP, T0);
    expect(await redeemSignInCode({ code, verifier: VERIFIER, redirectUri: APP }, at(121_000))).toEqual({ error: CODE_FAILED });
  });

  it("refuse a different redirect", async () => {
    const m = await mentor();
    const code = await issueSignInCode(m.id, CHALLENGE, APP, T0);
    expect(await redeemSignInCode({ code, verifier: VERIFIER, redirectUri: "freshlog://other" }, T0)).toEqual({ error: CODE_FAILED });
  });

  it("issuing a code clears the codes that have expired, and only those", async () => {
    const m = await mentor();
    await issueSignInCode(m.id, CHALLENGE, APP, T0);                      // expires at 120 s
    const live = await issueSignInCode(m.id, CHALLENGE, APP, at(60_000)); // expires at 180 s
    await issueSignInCode(m.id, CHALLENGE, APP, at(150_000));
    expect(await prisma.apiSignInCode.count()).toBe(2);
    expect(await redeemSignInCode({ code: live, verifier: VERIFIER, redirectUri: APP }, at(150_000))).toEqual({ userId: m.id });
  });

  it("issuing a code clears other people's expired codes too", async () => {
    const [a, b] = [await mentor(), await mentor()];
    await issueSignInCode(a.id, CHALLENGE, APP, T0);
    await issueSignInCode(b.id, CHALLENGE, APP, at(150_000));
    expect((await prisma.apiSignInCode.findMany()).map((row) => row.userId)).toEqual([b.id]);
  });
});
