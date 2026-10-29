import { changelogFor } from "@/lib/api/v1/changelog-view";
import { inactive, mayUse, ok, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** What's new: the website's changelog, the same for everybody, with what this reader hasn't seen marked. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  return ok(await changelogFor(user));
}
