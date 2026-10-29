import { inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { studentHomeFor } from "@/lib/api/v1/student-home";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * A student's home: their hours, whose time each part of them is and how to book
 * it, and what the website asks them to check.
 *
 * Only somebody with a student record has one. Anybody else is answered like a
 * page that does not exist, so the answer cannot be used to find out who studies.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const home = await studentHomeFor(user);
  if (!home) return refused("Not found.", 404);
  // /student sends them to onboarding first; so does this.
  if (home === "onboarding") return refused("Finish signing up first.", 403, { code: "onboarding" });
  return ok(home);
}
