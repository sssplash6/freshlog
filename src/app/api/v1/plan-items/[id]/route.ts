import { deleteAssignment, updateAssignment } from "@/lib/actions/assignments";
import { bodyOf } from "@/lib/api/v1/body";
import { planItemEditForm, planItemEditOf } from "@/lib/api/v1/plan-forms";
import { fromAction, inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { nameOf, readerFor } from "@/lib/api/v1/sessions";
import { planItemFor, storedPlanItem } from "@/lib/api/v1/work";
import { scopeCovers, scopeProgramFilter } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";
import { mentorsIn } from "@/lib/screens/student-record";
import { programToday } from "@/lib/when";

const NOT_YOURS = "That plan item is not yours to change.";

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
  const reader = await readerFor(user);
  const item = await planItemFor(reader, id);
  if (!item) return refused("Not found.", 404);
  return ok({ item, mentorChoices: item.can.delete ? await mentorChoicesFor(reader) : [], today: programToday() });
}

/**
 * Whom an admin may hand a plan item to: the student page's picker, every
 * mentor in the programs they run (`mentorsIn`), as the website's offers.
 */
async function mentorChoicesFor(reader: Awaited<ReturnType<typeof readerFor>>) {
  return (await mentorsIn(scopeProgramFilter(reader.read))).map((m) => ({ id: m.id, name: nameOf(m) }));
}

/**
 * Changes what the body names and leaves the rest of the plan item as it is.
 *
 * This is `updateAssignment`, the action the website calls, so who may and
 * what it refuses is the website's, in its words. The action replaces an item
 * whole, which is why `planItemEditForm` sends every field the body leaves out
 * as the item has it now, the note from the row itself (a student is shown
 * none). Progress moves through its own route.
 *
 * `mentor` hands the item to somebody else, which the action tells both of. It
 * is an admin's of the item's program: anyone else who names one gets a 403 in
 * `NOT_YOURS`. The mentor must be one the website's picker offers (a mentor in
 * a program the admin runs), which the action does not ask, so the route does;
 * null takes it off everybody.
 *
 * The item is read first, as GET reads it: one the person may not see is
 * answered like one that was never made, whatever the body says. One they may
 * see but not change (its student, a mentor who only reaches the student) is a
 * 403 in `NOT_YOURS`, since the action would call it missing. A value of
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
  // Seen but not theirs to change: the action would say the item no longer exists, which is false.
  if (!item.can.edit) return refused(NOT_YOURS, 403);
  const body = await bodyOf(request);
  if (!body) return refused("Send the changes as JSON.", 400);
  const asked = planItemEditOf(body);
  if ("field" in asked) return refused("That isn't a valid value.", 400, { field: asked.field });
  if (asked.edit.mentor !== undefined) {
    const reader = await readerFor(user);
    if (!scopeCovers(reader.write, item.program.id)) return refused(NOT_YOURS, 403);
    const choices = await mentorChoicesFor(reader);
    if (asked.edit.mentor !== null && !choices.some((m) => m.id === asked.edit.mentor)) {
      return refused("That isn't a valid value.", 400, { field: "mentor" });
    }
  }
  const form = planItemEditForm(item, asked.edit, stored);
  if (!(form instanceof FormData)) return refused("That isn't a valid value.", 400, { field: form.field });
  return fromAction(await updateAssignment(null, form));
}

/**
 * Deletes the plan item, through the website's `deleteAssignment`, which tells
 * its mentor. That is an admin's of the item's program, never its own mentor's:
 * a reader who may see it and not delete it gets a 403 in `NOT_YOURS`.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const item = await planItemFor(await readerFor(user), id);
  if (!item) return refused("Not found.", 404);
  if (!item.can.delete) return refused(NOT_YOURS, 403);
  const form = new FormData();
  form.set("assignmentId", id);
  return fromAction(await deleteAssignment(null, form));
}
