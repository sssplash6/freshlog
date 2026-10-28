import { restoreSession } from "@/lib/actions/sessions";
import { fromAction, inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import { sessionForm } from "@/lib/api/v1/session-forms";
import { readerFor, sessionFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Puts a voided session back: it counts again and its hours are charged again.
 * It is `restoreSession`, the action the website calls, which decides who may
 * and refuses everyone else in its words, as a 400. That includes a session
 * whose student has since left its program, for which `can.restore` is false
 * as well.
 *
 * A session the person may not see is answered like one that was never made.
 * The request has no body to read.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const session = await sessionFor(await readerFor(user), id);
  if (!session) return refused("Not found.", 404);
  return fromAction(await restoreSession(null, sessionForm(session.id)));
}
