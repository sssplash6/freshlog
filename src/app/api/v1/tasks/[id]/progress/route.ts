import { setStudentTaskProgress } from "@/lib/actions/student-tasks";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { taskFor } from "@/lib/api/v1/work";
import { taskProgressForm } from "@/lib/api/v1/work-forms";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Moves a task along: `{ done: true }`, or `{ percent }` (which reopens a
 * finished task, as it does on the website).
 *
 * This is `setStudentTaskProgress`. The task is read first, so one the person
 * may not see answers like one never made. One they may see but not move is the
 * action's to refuse, and comes back as a 400.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const task = await taskFor(await readerFor(user), id);
  if (!task) return refused("Not found.", 404);
  const body = await bodyOf(request);
  if (!body) return refused("Send the progress as JSON.", 400);
  const form = taskProgressForm(task.id, body);
  if (!(form instanceof FormData)) return refused("Send done: true, or a percent from 0 to 100.", 400, { field: form.field });
  return fromAction(await setStudentTaskProgress(null, form));
}
