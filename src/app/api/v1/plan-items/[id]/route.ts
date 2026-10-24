import { updateAssignment } from "@/lib/actions/assignments";
import { bodyOf } from "@/lib/api/v1/body";
import { planItemEditForm, planItemEditOf } from "@/lib/api/v1/plan-forms";
import { fromAction, inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { planItemFor, storedPlanItem } from "@/lib/api/v1/work";
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

/**
 * Changes what the body names and leaves the rest of the plan item as it is.
 *
 * This is `updateAssignment`, the action the website calls, so who may and
 * what it refuses is the website's, in its words. The action replaces an item
 * whole, which is why `planItemEditForm` sends every field the body leaves out
 * as the item has it now, the note from the row itself (a student is shown
 * none). The mentor and the progress are always the row's: choosing a mentor is
 * an admin's work, and progress moves through its own route.
 *
 * The item is read first, as GET reads it: one the person may not see is
 * answered like one that was never made, whatever the body says. One they may
 * see but not change (its student) is the action's to refuse, a 400. A value of
 * the wrong type, or a due day that is not on the calendar, is refused on its
 * field before the action runs.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const item = await planItemFor(await readerFor(user), id);
  const stored = item && (await storedPlanItem(id));
  if (!item || !stored) return refused("Not found.", 404);
  const body = await bodyOf(request);
  if (!body) return refused("Send the changes as JSON.", 400);
  const asked = planItemEditOf(body);
  if ("field" in asked) return refused("That isn't a valid value.", 400, { field: asked.field });
  const form = planItemEditForm(item, asked.edit, stored);
  if (!(form instanceof FormData)) return refused("That isn't a valid value.", 400, { field: form.field });
  return fromAction(await updateAssignment(null, form));
}
