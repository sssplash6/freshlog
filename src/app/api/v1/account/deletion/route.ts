import { ACCOUNT_DELETION_DAYS, requestDeletion, withdrawDeletion } from "@/lib/account-deletion";
import { ok, signInAgain } from "@/lib/api/v1/respond";
import type { DeletionResult } from "@/lib/api/v1/types";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

// Anyone signed in may ask, a student nobody has approved yet included: they
// have an account all the same, and the App Store's rule is about having one.

/** Ask for your account to be deleted (`requestDeletion`). Asking again changes nothing. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  const requestedAt = await requestDeletion(user);
  return ok<DeletionResult>({
    ok: true,
    message: `Your account will be deleted within ${ACCOUNT_DELETION_DAYS} days.`,
    requestedAt: requestedAt.toISOString(),
  });
}

/** Take the request back. */
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  await withdrawDeletion(user);
  return ok<DeletionResult>({ ok: true, message: "Your account will not be deleted.", requestedAt: null });
}
