import { mentorEditFor } from "@/lib/api/v1/mentors";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * What the website's Edit fold on a mentor's page offers (`mentorEditFor`):
 * for an admin who may change them. Anybody else, and no such mentor, is the
 * same 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const edit = await mentorEditFor(await readerFor(user), (await params).id);
  if (!edit) return refused("Not found.", 404);
  return ok(edit);
}
