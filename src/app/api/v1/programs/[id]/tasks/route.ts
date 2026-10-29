import { setProgramTask } from "@/lib/actions/student-tasks";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { programTaskForm } from "@/lib/api/v1/work-forms";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The same task for every student in a program, in one go: the website's
 * `setProgramTask`, an admin of the program's, which tells each student. The
 * body is judged first, field by field, as a student's task is.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const body = await bodyOf(request);
  if (!body) return refused("Send the task as JSON.", 400);
  const form = programTaskForm((await params).id, body);
  if (!(form instanceof FormData)) return refused("That isn't a valid value.", 400, { field: form.field });
  return fromAction(await setProgramTask(null, form));
}
