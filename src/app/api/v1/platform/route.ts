import { platformFor } from "@/lib/api/v1/platform";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** Who administers what, for platform admins; anybody else is a 404, as /settings/platform is to them. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const platform = await platformFor(user);
  if (!platform) return refused("Not found.", 404);
  return ok(platform);
}
