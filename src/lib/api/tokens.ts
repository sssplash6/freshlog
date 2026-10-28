import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";
import type { User } from "@/generated/prisma/client";

/**
 * Credentials for the freshlog app.
 *
 * A web sign-in hands the app a one-time CODE, bound to the PKCE challenge the
 * app started with. The app redeems it once, with the verifier only it holds,
 * for a bearer TOKEN that every later request carries.
 *
 * Neither is stored as issued: a database backup must not be a key to every
 * phone, so the tables keep only the SHA-256 of each. Both are 256 random bits,
 * so a plain hash is enough — there is nothing to guess.
 *
 * Where the time matters, the clock is an optional last argument, so a test can
 * set it instead of waiting for it.
 */

export const TOKEN_TTL_DAYS = 90;
export const CODE_TTL_SECONDS = 120;

/** The one answer to every way a code can fail, so a reply never says which. */
export const CODE_FAILED = "That sign-in didn't finish. Try again.";

const DAY_MS = 24 * 60 * 60 * 1000;

/** What is stored in place of a token or a code. */
const hashOf = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");

const newSecret = () => randomBytes(32).toString("base64url");

const addDays = (from: Date, days: number) =>
  new Date(from.getTime() + days * DAY_MS);

/**
 * The token in an `Authorization: Bearer <token>` header.
 *
 * `undefined`: no header at all. `null`: a header that isn't "Bearer <token>".
 * The scheme name is case-insensitive; the token is whatever follows it.
 */
export function bearerFrom(header: string | null): string | null | undefined {
  if (header === null) return undefined;
  return /^Bearer +(\S+)$/i.exec(header)?.[1] ?? null;
}

/**
 * A new token for `userId`. Its plain text is in this return value and nowhere else.
 *
 * Every token that has expired or been ended, whoever's it was, is deleted first.
 * `userForToken` refuses such a row from that moment, and nothing else would ever
 * remove it.
 */
export async function issueToken(
  userId: string,
  deviceName: string | null,
  now: Date = new Date()
): Promise<{ token: string; expiresAt: Date }> {
  await prisma.apiToken.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }] },
  });

  const token = newSecret();
  const expiresAt = addDays(now, TOKEN_TTL_DAYS);
  // The clock is the caller's, so the three dates are written here and not left
  // to the columns' `now()` defaults.
  await prisma.apiToken.create({
    data: {
      userId,
      tokenHash: hashOf(token),
      deviceName,
      createdAt: now,
      lastUsedAt: now,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

/**
 * Whose token this is, or null when it is unknown, revoked or expired.
 *
 * A token that is used does not run out: a use more than a day after the last
 * one starts its 90 days again. The day is so a phone in constant use does not
 * write to the database on every request.
 */
export async function userForToken(
  token: string,
  now: Date = new Date()
): Promise<User | null> {
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashOf(token) },
    include: { user: true },
  });
  if (!row || row.revokedAt || row.expiresAt.getTime() <= now.getTime()) {
    return null;
  }

  if (now.getTime() - row.lastUsedAt.getTime() > DAY_MS) {
    await prisma.apiToken.update({
      where: { id: row.id },
      data: { lastUsedAt: now, expiresAt: addDays(now, TOKEN_TTL_DAYS) },
    });
  }
  return row.user;
}

/**
 * Ends a token for good, and stops pushing to the phones that signed in with it:
 * the row stays (revoked) until the next `issueToken` sweeps it, and its
 * DeviceToken rows would wait with it. One that is unknown, or already ended, is
 * left alone.
 */
export async function revokeToken(token: string): Promise<void> {
  const tokenHash = hashOf(token);
  await prisma.$transaction([
    prisma.deviceToken.deleteMany({ where: { apiToken: { tokenHash } } }),
    prisma.apiToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

/**
 * The id of the sign-in this token is, while it is live (not revoked, not
 * expired), or null. For a route that ties something to the sign-in itself
 * rather than to the person: a phone's push token, which ends when it does.
 */
export async function liveTokenId(token: string, now: Date = new Date()): Promise<string | null> {
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashOf(token) },
    select: { id: true, revokedAt: true, expiresAt: true },
  });
  if (!row || row.revokedAt || row.expiresAt.getTime() <= now.getTime()) return null;
  return row.id;
}

/**
 * A one-time code for `userId`, good for two minutes, and only for the app that
 * sent `challenge` and is waiting at `redirectUri`.
 *
 * Every code that has expired, whoever's it was, is deleted first. The Continue
 * page makes one per view and most are never redeemed, so nothing else would
 * ever remove them; `redeemSignInCode` refuses such a row from that moment.
 */
export async function issueSignInCode(
  userId: string,
  challenge: string,
  redirectUri: string,
  now: Date = new Date()
): Promise<string> {
  await prisma.apiSignInCode.deleteMany({ where: { expiresAt: { lte: now } } });

  const code = newSecret();
  await prisma.apiSignInCode.create({
    data: {
      codeHash: hashOf(code),
      userId,
      challenge,
      redirectUri,
      expiresAt: new Date(now.getTime() + CODE_TTL_SECONDS * 1000),
      createdAt: now,
    },
  });
  return code;
}

/**
 * Says in the server's log why a sign-in code was refused. The app is told only
 * CODE_FAILED, whatever the reason, so an answer says nothing about the code;
 * the log is the one place a failed sign-in can be told apart. Never the code
 * or the verifier: only the reason, and the redirect the app sent.
 */
export function refusedBecause(reason: string): void {
  console.warn(`[api] sign-in code refused: ${reason}`);
}

/**
 * Trades a code for the user it was issued to. A code works once.
 *
 * The code is deleted before anything is checked, so a wrong verifier, a wrong
 * redirect or a late arrival all spend it, and it cannot be tried again. Every
 * refusal is the same `CODE_FAILED`, and is RETURNED rather than thrown: a throw
 * would roll the delete back and leave the code to be guessed at again.
 */
export async function redeemSignInCode(
  input: { code: string; verifier: string; redirectUri: string },
  now: Date = new Date()
): Promise<{ userId: string } | { error: string }> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.apiSignInCode.findUnique({
      where: { codeHash: hashOf(input.code) },
    });
    if (!row) {
      refusedBecause("no such code: already used, or never made");
      return { error: CODE_FAILED };
    }

    await tx.apiSignInCode.delete({ where: { codeHash: row.codeHash } });

    // PKCE, method S256 (RFC 7636): the verifier is what proves this is the app
    // that started the sign-in. The redirect must be the one the code was made for.
    const challenge = createHash("sha256")
      .update(input.verifier)
      .digest("base64url");
    const reason =
      row.expiresAt.getTime() <= now.getTime()
        ? "the code is more than two minutes old"
        : row.redirectUri !== input.redirectUri
          ? `the redirect is not the one the code was made for (${JSON.stringify(input.redirectUri)})`
          : challenge !== row.challenge
            ? "the verifier does not match the challenge (PKCE)"
            : null;
    if (reason) {
      refusedBecause(reason);
      return { error: CODE_FAILED };
    }
    return { userId: row.userId };
  });
}
