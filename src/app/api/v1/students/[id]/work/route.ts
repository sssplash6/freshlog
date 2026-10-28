import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { studentWorkFor } from "@/lib/api/v1/student-work";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * One student's tasks and plan items, for the staff who read their page: an
 * admin of one of their programs, or a mentor who reaches them
 * (`studentWorkFor`). Anybody else, and a student who does not exist, are
 * answered alike, so the answer cannot be used to find out who studies.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const work = await studentWorkFor(await readerFor(user), id);
  if (!work) return refused("Not found.", 404);
  return ok(work);
}
