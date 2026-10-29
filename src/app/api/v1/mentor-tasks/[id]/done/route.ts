import { setMentorTaskDone } from "@/lib/actions/mentor-tasks";
import { bodyOf } from "@/lib/api/v1/body";
import { mentorShareFor } from "@/lib/api/v1/mentor-tasks";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * A mentor ticks their share of a task off, or takes the tick back. `:id` is the
 * share (`MentorTaskAssignee.id`), and the body is `{ done: boolean }`.
 *
 * `setMentorTaskDone` reads every intent but "done" as "take it back", so a
 * missing flag would quietly reopen a finished task. The route therefore
 * refuses a body that does not say which, and always sends the intent itself.
 * Somebody else's share answers like one that was never made.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { id } = await params;
  const share = await mentorShareFor(user, id);
  if (!share) return refused("Not found.", 404);
  const done = (await bodyOf(request))?.done;
  if (typeof done !== "boolean") return refused("Say whether it is done.", 400, { field: "done" });
  const form = new FormData();
  form.set("assigneeId", share.id);
  form.set("intent", done ? "done" : "reopen");
  return fromAction(await setMentorTaskDone(null, form));
}
