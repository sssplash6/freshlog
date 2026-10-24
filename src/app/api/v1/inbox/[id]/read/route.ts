import { markRead } from "@/lib/api/v1/inbox";
import { inactive, noContent, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Marks one of the signed-in person's notifications read. Another person's id
 * answers exactly like an id that was never made. Marking one that is already
 * read changes nothing and answers the same 204.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  if (!(await markRead(user.id, id))) return refused("Not found.", 404);
  return noContent();
}
