import { setStudentTask } from "@/lib/actions/student-tasks";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { taskCreateForm } from "@/lib/api/v1/work-forms";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Sets a student a task, in one of the programs they study in.
 *
 * This is `setStudentTask`, the action the website calls, so who may set one
 * (an admin of the program, or a mentor who works with the student in it) and
 * what a task may say are the website's, in its words. The action tells the
 * student and queues their email, and answers no id: the app learns of the task
 * from its next read.
 *
 * The body is judged first, field by field, because the action refuses a bad
 * day or an over-long title without saying which field is wrong.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const body = await bodyOf(request);
  if (!body) return refused("Send the task as JSON.", 400);
  const form = taskCreateForm(body);
  if (!(form instanceof FormData)) return refused("That isn't a valid value.", 400, { field: form.field });
  return fromAction(await setStudentTask(null, form));
}
