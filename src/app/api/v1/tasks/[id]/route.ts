import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { taskFor } from "@/lib/api/v1/work";
import { getCurrentUser } from "@/lib/dal";
import { programToday } from "@/lib/when";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * One task, as the person reading it may see it: its student, a mentor who
 * reaches the student, or an admin of its program (`taskFor`).
 *
 * Anybody else's task answers exactly like an id that was never made, so the
 * answer cannot be used to find out which tasks exist. `today` is the program's
 * day, the earliest a new due day may take.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const task = await taskFor(await readerFor(user), id);
  if (!task) return refused("Not found.", 404);
  return ok({ task, today: programToday() });
}
