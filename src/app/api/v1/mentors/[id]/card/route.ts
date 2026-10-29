import { mentorCardFor } from "@/lib/api/v1/mentors";
import { inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Another mentor's card (`mentorCardFor`), as the website shows them to a
 * mentor who shares a program with them. Somebody who shares none, and no such
 * mentor, is the same 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const card = await mentorCardFor(user, (await params).id);
  if (!card) return refused("Not found.", 404);
  return ok(card);
}
