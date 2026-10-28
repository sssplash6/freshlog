import { ratingsPageFor } from "@/lib/api/v1/ratings-page";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Ratings, as /feedback shows them: staff read every rating their ADMIN and
 * LEADER grants reach, a mentor their own, anonymous. Anybody else is a 404;
 * a student's are at GET feedback.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const ratings = await ratingsPageFor(user, params);
  if (!ratings) return refused("Not found.", 404);
  return ok(ratings);
}
