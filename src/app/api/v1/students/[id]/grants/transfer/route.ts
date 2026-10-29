import { transferMentorAllocation } from "@/lib/actions/students";
import { programRefusal } from "@/lib/api/v1/admin-gates";
import { managedStudent } from "@/lib/api/v1/admin-student";
import { bodyOf } from "@/lib/api/v1/body";
import { transferForm } from "@/lib/api/v1/grant-forms";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** The action's one sentence for a grant that is gone and for one that isn't the reader's. */
const GONE = "That allocation no longer exists.";

/**
 * Moves a student's unused minutes from one mentor, or the pool, to another,
 * through the website's `transferMentorAllocation`. Only what is unused moves;
 * the action says so when asked for more.
 *
 * A grant that is not there is a 404, as a student or program the reader does
 * not read is.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { id } = await params;
  const reader = await readerFor(user);
  if (!(await managedStudent(reader, id))) return refused("Not found.", 404);
  const body = await bodyOf(request);
  if (!body) return refused("Send the move as JSON.", 400);
  const gate = programRefusal(reader, body.program);
  if (gate) return gate;
  const form = transferForm(id, body);
  if (!(form instanceof FormData)) return refused("That isn't a valid value.", 400, { field: form.field });
  const state = await transferMentorAllocation(null, form);
  if (state && !state.ok && state.error === GONE) return refused("Not found.", 404);
  return fromAction(state);
}
