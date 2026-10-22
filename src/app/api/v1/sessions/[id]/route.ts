import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor, sessionFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * One session, as the person reading it may see it: its student, the mentor
 * who logged it, or an admin of its program (`sessionFor`).
 *
 * Anybody else's session answers exactly like an id that was never made, so
 * the answer cannot be used to find out which sessions exist.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const session = await sessionFor(await readerFor(user), id);
  if (!session) return refused("Not found.", 404);
  return ok(session);
}
