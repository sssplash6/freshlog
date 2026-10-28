import { issueToken } from "@/lib/api/tokens";
import { ok, refused } from "@/lib/api/v1/respond";
import type { SampleAccount, TokenResponse } from "@/lib/api/v1/types";
import { devLoginEnabled } from "@/lib/dev-login";
import { prisma } from "@/lib/prisma";

// Reads the database and the environment on every request; never prerender.
export const dynamic = "force-dynamic";

const NO_ACCOUNT = "No account with that email.";

/**
 * The accounts the app may sign in as on a developer's own machine.
 *
 * This is /api/dev-login for the app: a fresh local database holds accounts
 * nobody has the Google login for, so a developer signs the app in as one of
 * them instead. It lists the same people, in the same order, as that page does.
 *
 * It is on under that route's rule and no other (`devLoginEnabled`, in
 * src/lib/dev-login.ts), and everywhere else it is a 404 in the API's one
 * not-found body. The rule is the first line of both handlers, ahead of any
 * query, so a server that is off cannot be asked who has an account.
 */
export async function GET(request: Request) {
  if (!devLoginEnabled(request)) return refused("Not found.", 404);

  const accounts: SampleAccount[] = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { email: "asc" }],
    select: { email: true, name: true, role: true, status: true },
  });
  return ok({ accounts });
}

/**
 * Signs in as the account whose email is in the body, `{ email }`, and answers
 * with the token the real sign-in ends with. Every route then reads that person
 * as it would one who came through Google, by their real role and status.
 *
 * It does not check `status`, as /api/dev-login does not: a student nobody has
 * approved is exactly who a developer signs in as to see what the app shows
 * one. Nothing but the email is read, so the token has no device name.
 *
 * An email that is no account, a body with no email in it and a body that
 * cannot be read are the same 404 in the same words, and never a 500.
 */
export async function POST(request: Request) {
  if (!devLoginEnabled(request)) return refused("Not found.", 404);

  const body: unknown = await request.json().catch(() => null);
  const email = typeof body === "object" && body !== null ? (body as { email?: unknown }).email : undefined;
  if (typeof email !== "string") return refused(NO_ACCOUNT, 404);

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true },
  });
  if (!user) return refused(NO_ACCOUNT, 404);

  const { token, expiresAt } = await issueToken(user.id, null);
  return ok({ token, expiresAt: expiresAt.toISOString() } satisfies TokenResponse);
}
