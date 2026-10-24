import { deleteStudentTask, updateStudentTask } from "@/lib/actions/student-tasks";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { taskFor } from "@/lib/api/v1/work";
import { taskEditForm, taskEditOf } from "@/lib/api/v1/work-forms";
import { getCurrentUser } from "@/lib/dal";
import { programToday } from "@/lib/when";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** `assertTaskScope`'s own words for a task the person may read and may not change. */
const NOT_YOURS = "That task is not yours to change.";

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

/**
 * Changes what the body names and leaves the rest of the task as it is.
 *
 * This is `updateStudentTask`, which replaces title, day and note whole, so
 * `taskEditForm` sends each one the body leaves out as the task has it now. The
 * task is read first, as GET reads it: one the person may not see is answered
 * like one that was never made. One they may see but not change is the action's
 * is refused with a 403, in `assertTaskScope`'s words.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const task = await taskFor(await readerFor(user), id);
  if (!task) return refused("Not found.", 404);
  // Seen but not theirs to change: the action would say the task no longer exists, which is false.
  if (!task.can.edit) return refused(NOT_YOURS, 403);
  const body = await bodyOf(request);
  if (!body) return refused("Send the changes as JSON.", 400);
  const asked = taskEditOf(body);
  if ("field" in asked) return refused("That isn't a valid value.", 400, { field: asked.field });
  const form = taskEditForm(task, asked.edit);
  if (!(form instanceof FormData)) return refused("That isn't a valid value.", 400, { field: form.field });
  return fromAction(await updateStudentTask(null, form));
}

/**
 * Takes a task off the student's list, for good: `deleteStudentTask` has no
 * inverse, and tells the student. Read first, as PATCH is.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const task = await taskFor(await readerFor(user), id);
  if (!task) return refused("Not found.", 404);
  if (!task.can.delete) return refused(NOT_YOURS, 403);
  const form = new FormData();
  form.set("taskId", task.id);
  return fromAction(await deleteStudentTask(null, form));
}
