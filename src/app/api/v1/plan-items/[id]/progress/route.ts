import { setAssignmentProgress } from "@/lib/actions/assignments";
import { bodyOf } from "@/lib/api/v1/body";
import { planItemProgressForm } from "@/lib/api/v1/plan-forms";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { planItemFor } from "@/lib/api/v1/work";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Sets a plan item's progress to `NOT_STARTED`, `IN_PROGRESS` or `DONE`, which
 * pins it there, or to `AUTO`, which lets it follow its logged hours again.
 *
 * This is `setAssignmentProgress`, the action the website's one-click control
 * calls. Who may is the owning mentor and the admins of the item's program;
 * someone who can see the item and is neither (its student, a co-mentor) gets a
 * 403, since the action would call it missing. Any other word is refused on
 * `progress` before the action runs.
 *
 * An item the person may not see is answered like one that was never made.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { id } = await params;
  const item = await planItemFor(await readerFor(user), id);
  if (!item) return refused("Not found.", 404);
  // Seen but not theirs to change: the action would say the item no longer exists, which is false.
  if (!item.can.progress) return refused("That plan item is not yours to change.", 403);
  const form = planItemProgressForm(item.id, await bodyOf(request));
  if (!(form instanceof FormData)) return refused("Pick a progress state.", 400, { field: form.field });
  return fromAction(await setAssignmentProgress(null, form));
}
