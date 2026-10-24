import { programOptionsFor } from "@/lib/api/v1/programs";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { scopeIsEmpty } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The running programs the reader may change, with their levels and cohorts,
 * for Add students and Register a mentor (`programOptionsFor`). A reader who
 * may change none is answered like a page that does not exist.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const reader = await readerFor(user);
  if (scopeIsEmpty(reader.write)) return refused("Not found.", 404);
  return ok(await programOptionsFor(reader));
}
