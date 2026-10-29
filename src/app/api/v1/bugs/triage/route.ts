import { triageFor } from "@/lib/api/v1/bug-view";
import { inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readTriageFilter } from "@/lib/bugs";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** The triage board (`?kind=BUG|FEATURE`), for platform admins; anybody else is a 404, as /bugs/triage is to them. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const board = await triageFor(user, readTriageFilter(new URL(request.url).searchParams.get("kind") ?? ""));
  if (!board) return refused("Not found.", 404);
  return ok(board);
}
