import { editSession } from "@/lib/actions/sessions";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { editForm, editOf } from "@/lib/api/v1/session-forms";
import { readerFor, sessionFor, storedNote } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * One session, as the person reading it may see it: its student, the mentor
 * who logged it, or an admin of its program (`sessionFor`).
 *
 * Anybody else's session answers exactly like an id that was never made, so
 * the answer cannot be used to find out which sessions exist.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { id } = await params;
  const session = await sessionFor(await readerFor(user), id);
  if (!session) return refused("Not found.", 404);
  return ok(session);
}

/**
 * Changes what the body names and leaves the rest of the session as it is.
 *
 * This is `editSession`, the action the website calls, so what it allows and
 * refuses is the website's, in its words. The action replaces a session whole,
 * which is why `editForm` sends every field the body leaves out as the session
 * has it now.
 *
 * The session is read first, as GET reads it: one the person may not see is
 * answered like one that was never made, whatever the body says. One they may
 * see but not change is the action's to refuse, and comes back as a 400. The
 * body is judged after that, field by field: a value of the wrong type is
 * refused on its field, and what a value says is left to the action.
 *
 * A note the body leaves out is kept from the row itself (`storedNote`), never
 * from what the person was shown: a student who also administers the program
 * may edit their own session and is shown no note, so filling it from that
 * would erase the mentor's. The stored note goes to the action and no further:
 * `fromAction` answers the action's sentence alone, and the session the action
 * echoes back, which carries the note it saved, is not sent.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { id } = await params;
  const session = await sessionFor(await readerFor(user), id);
  if (!session) return refused("Not found.", 404);
  const body = await bodyOf(request);
  if (!body) return refused("Send the changes as JSON.", 400);
  const asked = editOf(body);
  if ("field" in asked) return refused("That isn't a valid value.", 400, { field: asked.field });
  return fromAction(await editSession(null, editForm(session, asked.edit, await storedNote(session.id))));
}
