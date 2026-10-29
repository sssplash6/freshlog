import { inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import type { ApiSearch, SearchHit } from "@/lib/api/v1/types";
import { normalizeQuery, type SearchPerson } from "@/lib/command-search";
import { USER_STATUS } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";
import { searchFor, searchReach } from "@/lib/search";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

const hit = (p: SearchPerson): SearchHit => ({ id: p.id, userId: p.userId, name: p.name ?? p.email, email: p.email, programs: p.programs });

/**
 * Search, for the app: the website's command palette (`/api/search`) under the
 * bearer. Who may find whom is `searchFor`'s, asked exactly as the palette asks
 * it; the answer is the palette's, without the picture's timestamp.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  // The website's palette finds nobody for a mentor no program has taken on yet (`/api/search`); nor does this.
  if (user.status === USER_STATUS.UNASSIGNED) return ok({ students: [], mentors: [] } satisfies ApiSearch);
  const q = normalizeQuery(new URL(request.url).searchParams.get("q"));
  if (q === null) {
    return (await searchReach(user)) ? ok({ students: [], mentors: [] } satisfies ApiSearch) : refused("Not found.", 404);
  }
  const results = await searchFor(user, q);
  if (!results) return refused("Not found.", 404);
  return ok({ students: results.students.map(hit), mentors: results.mentors.map(hit) } satisfies ApiSearch);
}
