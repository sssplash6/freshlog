import { mentorHomeFor } from "@/lib/api/v1/mentor-home";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { canActAsMentor } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * A mentor's home: the students they hold time with, how each stands, and what
 * needs them.
 *
 * Only somebody who can act as a mentor has one. Anybody else is answered like a
 * page that does not exist, so the answer cannot be used to find out who
 * mentors. That includes an admin who does not mentor, who must not be handed
 * the staff's list in its place (`mentorHomeFor`).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  if (!canActAsMentor(user)) return refused("Not found.", 404);
  // The page's own tabs and order, by its own names; the page ignores what it doesn't know, and so does this.
  const query = new URL(request.url).searchParams;
  const param = (key: string) => query.get(key)?.trim() || undefined;
  return ok(await mentorHomeFor(user, { program: param("program"), level: param("level"), sort: param("sort"), dir: param("dir") }));
}
