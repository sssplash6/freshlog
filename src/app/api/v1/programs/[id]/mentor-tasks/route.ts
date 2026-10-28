import { setMentorTask } from "@/lib/actions/mentor-tasks";
import { bodyOf } from "@/lib/api/v1/body";
import { mentorTaskForm, programMentorTasksFor } from "@/lib/api/v1/program-mentor-tasks";
import { programGate } from "@/lib/api/v1/programs";
import { fromAction, inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { scopeCovers } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The program's tasks for mentors, to anyone who reads the program (`programMentorTasksFor`). */
export async function GET(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const reader = await readerFor(user);
  const gate = await programGate(reader, (await params).id, { write: false });
  if ("refusal" in gate) return gate.refusal;
  return ok(await programMentorTasksFor(gate.program.id, scopeCovers(reader.write, gate.program.id)));
}

/**
 * Gives the program's mentors a task, through the website's `setMentorTask`,
 * which tells each of them. No id comes back. There is no edit: the website has
 * none, so a task is withdrawn and set again.
 */
export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const gate = await programGate(await readerFor(user), (await params).id, { write: true });
  if ("refusal" in gate) return gate.refusal;
  const body = await bodyOf(request);
  if (!body) return refused("Send the task as JSON.", 400);
  const form = await mentorTaskForm(gate.program.id, body);
  if (!(form instanceof FormData)) return refused("That isn't a valid value.", 400, { field: form.field });
  return fromAction(await setMentorTask(null, form));
}
