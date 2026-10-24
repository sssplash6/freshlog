import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { planItemFor } from "@/lib/api/v1/work";
import { getCurrentUser } from "@/lib/dal";
import { programToday } from "@/lib/when";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * One plan item (the website's agenda item), as the person reading it may see
 * it: its student, a mentor who reaches the student, or an admin of its program
 * (`planItemFor`). A student's answer carries no note: that is the staff's.
 *
 * Anybody else's answers exactly like an id that was never made. `today` is the
 * program's day, the earliest a new due day may take.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const item = await planItemFor(await readerFor(user), id);
  if (!item) return refused("Not found.", 404);
  return ok({ item, today: programToday() });
}
