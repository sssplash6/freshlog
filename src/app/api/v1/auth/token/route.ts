import { CODE_FAILED, issueToken, redeemSignInCode } from "@/lib/api/tokens";
import { ok, refused } from "@/lib/api/v1/respond";
import type { TokenResponse } from "@/lib/api/v1/types";

// Reads the database on every request; never prerender. On Render the SQLite
// disk only exists at runtime.
export const dynamic = "force-dynamic";

const MAX_DEVICE_NAME = 100;

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

/** What to call the phone, or null when the app did not say or sent something else. */
const deviceNameFrom = (value: unknown): string | null =>
  typeof value === "string" ? value.trim().slice(0, MAX_DEVICE_NAME) || null : null;

/**
 * Trades the one-time code for the app's bearer token.
 *
 * Every way a request can fail is the same 400 with the same words, so an answer
 * says nothing about the code. The three fields are checked to be text BEFORE the
 * code is looked up: `redeemSignInCode` hashes the verifier inside its
 * transaction, after the code is deleted, and a verifier that is not text would
 * throw there, roll the delete back and leave the code to be tried again. That
 * throw would also happen only for a code that exists, which tells the sender
 * which codes do.
 */
export async function POST(request: Request) {
  // This route is the sign-in itself, so there is no session to check: the code
  // and the verifier it was made for are the whole credential.
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) return refused(CODE_FAILED, 400);

  const { code, code_verifier, redirect_uri, device_name } = body as Record<string, unknown>;
  if (!isText(code) || !isText(code_verifier) || !isText(redirect_uri)) {
    return refused(CODE_FAILED, 400);
  }

  const redeemed = await redeemSignInCode({ code, verifier: code_verifier, redirectUri: redirect_uri });
  if ("error" in redeemed) return refused(CODE_FAILED, 400);

  const { token, expiresAt } = await issueToken(redeemed.userId, deviceNameFrom(device_name));
  return ok({ token, expiresAt: expiresAt.toISOString() } satisfies TokenResponse);
}
