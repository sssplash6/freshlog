import { mentorTasksFor } from "@/lib/api/v1/mentor-tasks";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The tasks a program's admin gave the signed-in mentor: their open ones, and
 * those they finished in the last fortnight.
 *
 * Only somebody who can act as a mentor has any. Anybody else is answered like a
 * page that does not exist, so the answer cannot be used to find out who mentors.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const tasks = await mentorTasksFor(user);
  if (!tasks) return refused("Not found.", 404);
  return ok(tasks);
}
