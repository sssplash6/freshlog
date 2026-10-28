import { adminHomeFor } from "@/lib/api/v1/admin";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { scopeIsEmpty } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * A program admin's home: their programs, the school's figures, and what needs
 * them (`adminHomeFor`).
 *
 * Only somebody who reads a program has one, at any level of grant, and a
 * platform admin, whose school may be empty. Anybody else is answered like a
 * page that does not exist, so the answer cannot be used to find out who
 * administers.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const reader = await readerFor(user);
  if (scopeIsEmpty(reader.read)) return refused("Not found.", 404);
  return ok(await adminHomeFor(reader));
}
