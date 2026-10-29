import { removeInterviewSlot } from "@/lib/actions/interviews";
import { anyPracticeViewer, NOT_A_STUDENT } from "@/lib/api/v1/practice";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Withdraw a time nobody has booked: `removeInterviewSlot`. Another student's
 * time and one that does not exist are the same 404; a booked one is refused
 * in the action's words (it is cancelled instead).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const me = anyPracticeViewer(user);
  if (!me) return refused(NOT_A_STUDENT, 403);
  const { id } = await params;
  const slot = await prisma.interviewSlot.findUnique({ where: { id }, select: { userId: true } });
  if (!slot || slot.userId !== me.user.id) return refused("Not found.", 404);
  const form = new FormData();
  form.set("slotId", id);
  return fromAction(await removeInterviewSlot(null, form));
}
