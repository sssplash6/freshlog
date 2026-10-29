import { updateMentor } from "@/lib/actions/mentors";
import { bodyOf } from "@/lib/api/v1/body";
import { mentorRecordFor } from "@/lib/api/v1/mentor-record";
import { mentorEditForm } from "@/lib/api/v1/mentors";
import { fromAction, inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * A mentor's record (`?period=30d|all`, `?from=&to=` for a custom range, ninety
 * days when left out): for the
 * mentor themselves and for an admin who manages them. Anybody else, and no
 * such mentor, is the same 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const record = await mentorRecordFor(user, (await params).id, query);
  if (!record) return refused("Not found.", 404);
  return ok(record);
}

/**
 * Edits a mentor through the website's `updateMentor` (`MentorEditRequest`):
 * their name and email, which only a platform admin may move (the action says
 * so in its words), and where they work in the reader's programs. Somebody who
 * may not change the mentor, and no such mentor, is a 404.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const body = await bodyOf(request);
  if (!body) return refused("Send the changes as JSON.", 400);
  const form = await mentorEditForm(await readerFor(user), (await params).id, body);
  if (form instanceof Response) return form;
  return fromAction(await updateMentor(null, form));
}
