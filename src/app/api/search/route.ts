import { USER_STATUS } from "@/lib/constants";
import { normalizeQuery, type SearchResults } from "@/lib/command-search";
import { getCurrentUser } from "@/lib/dal";
import { searchFor, searchReach } from "@/lib/search";

// Reads the session and the database on every request; never prerender.
export const dynamic = "force-dynamic";

const EMPTY: SearchResults = { students: [], mentors: [] };

/**
 * The command palette's people: `GET /api/search?q=…`.
 *
 * Gated here, on the first line, and not by the shell that mounts the palette:
 * a route answers anyone who knows its address, and a roster search is exactly
 * the payload the 3 September incident leaked. Who may find whom is decided in
 * `searchFor`, which asks the same questions `/students` and `/mentors` ask.
 *
 * A student — or anybody else with no roster — gets the same 404 an unknown
 * address gets, so the route does not confirm to them that there is a list
 * behind it.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.status !== USER_STATUS.ACTIVE) {
    return Response.json({ error: "You are not signed in." }, { status: 401 });
  }

  const q = normalizeQuery(new URL(request.url).searchParams.get("q"));
  if (q === null) {
    // Nothing asked is not the same as nobody allowed: answer an empty
    // question emptily without a query, but only for somebody with a roster.
    return (await searchReach(user))
      ? Response.json(EMPTY, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: "Not found." }, { status: 404 });
  }

  const results = await searchFor(user, q);
  if (!results) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return Response.json(results, { headers: { "Cache-Control": "no-store" } });
}
