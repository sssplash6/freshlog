import { meFor } from "@/lib/api/v1/me";
import { ok, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Who is signed in, which parts of the app they may use, and what they still
 * have to set up.
 *
 * It does not check `status`, and that is the point of it. A student nobody has
 * approved and a mentor no program has taken on both have a token, and this is
 * how the app learns why its home is not open yet. Every other route under
 * /api/v1, bar sign-in, turns them away.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  return ok(await meFor(user));
}
