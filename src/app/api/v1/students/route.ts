import { inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { rosterFor } from "@/lib/api/v1/roster";
import { rosterQueryFrom } from "@/lib/api/v1/roster-forms";
import { readerFor } from "@/lib/api/v1/sessions";
import { scopeIsEmpty } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The admin's roster: every student in the programs the reader reads, with
 * their figures over those programs, a page at a time (`rosterFor`).
 *
 * A mentor's own students are their home's. A reader with no program to read
 * is answered like a page that does not exist.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const reader = await readerFor(user);
  if (scopeIsEmpty(reader.read)) return refused("Not found.", 404);
  const query = rosterQueryFrom(new URL(request.url).searchParams);
  if ("field" in query) return refused("That isn't a valid value.", 400, { field: query.field });
  return ok(await rosterFor(reader, query));
}
