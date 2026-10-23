import { logOptionsFor } from "@/lib/api/v1/log";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { canActAsMentor } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Who the signed-in mentor can log a session for, how many minutes each has
 * left with them, and what they logged last (`logOptionsFor`).
 *
 * It is for somebody who can act as a mentor. To anyone else it answers like a
 * route that does not exist, so the answer says nothing about who mentors.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  if (!canActAsMentor(user)) return refused("Not found.", 404);
  return ok(await logOptionsFor(user));
}
