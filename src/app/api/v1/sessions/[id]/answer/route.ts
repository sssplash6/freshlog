import { answerSession } from "@/lib/actions/sessions";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import { answerForm, answerOf } from "@/lib/api/v1/session-forms";
import { readerFor, sessionFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The student's answer to a session their mentor logged: it happened
 * (`CONFIRMED`), or it did not (`DISPUTED`, which needs a `note` saying what
 * was wrong). It is `answerSession`, the action the website calls, which lets
 * only the session's own student answer and moves no balance.
 *
 * A session the person may not see is answered like one that was never made. The
 * mentor and the admins of its program do see it, and are refused by the action
 * in its words, as a 400: it is not theirs to answer.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const session = await sessionFor(await readerFor(user), id);
  if (!session) return refused("Not found.", 404);
  const body = await bodyOf(request);
  if (!body) return refused("Send the answer as JSON.", 400);
  const asked = answerOf(body);
  if ("field" in asked) return refused("That isn't a valid value.", 400, { field: asked.field });
  return fromAction(await answerSession(null, answerForm(session.id, asked.request)));
}
