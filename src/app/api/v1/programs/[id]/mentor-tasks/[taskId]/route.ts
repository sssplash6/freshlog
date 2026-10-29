import { deleteMentorTask } from "@/lib/actions/mentor-tasks";
import { programGate } from "@/lib/api/v1/programs";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Withdraws a task, through the website's `deleteMentorTask`. Its mentors stop
 * seeing it and are not told. A task of another program is answered like one
 * that does not exist.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { id, taskId } = await params;
  const gate = await programGate(await readerFor(user), id, { write: true });
  if ("refusal" in gate) return gate.refusal;
  const task = await prisma.mentorTask.findFirst({ where: { id: taskId, programId: id }, select: { id: true } });
  if (!task) return refused("Not found.", 404);
  const form = new FormData();
  form.set("taskId", task.id);
  return fromAction(await deleteMentorTask(null, form));
}
