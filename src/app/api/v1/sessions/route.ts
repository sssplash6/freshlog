import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { ledgerScope, readerFor, sessionsPage, sessionsQueryFrom } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The signed-in person's ledger: a student's own sessions, or the ones a mentor
 * logged, a page at a time, with figures for the whole filter (`sessionsPage`).
 *
 * Somebody who is neither has no ledger to read, and is told what any id that
 * isn't theirs is told.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const reader = await readerFor(user);
  if (!ledgerScope(reader)) return refused("Not found.", 404);
  const page = await sessionsPage(reader, sessionsQueryFrom(new URL(request.url).searchParams));
  if ("refused" in page) return refused(page.refused, 400, { field: page.field });
  return ok(page);
}
