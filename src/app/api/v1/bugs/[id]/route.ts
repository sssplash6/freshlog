import { bugFor } from "@/lib/api/v1/bug-view";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** One report, for whoever sent it and for platform admins. Anybody else's is the same 404 as none. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const bug = await bugFor(user, (await params).id);
  if (!bug) return refused("Not found.", 404);
  return ok(bug);
}
