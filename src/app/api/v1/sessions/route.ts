import { logSession } from "@/lib/actions/sessions";
import { bodyOf } from "@/lib/api/v1/body";
import { logForm } from "@/lib/api/v1/log";
import { fromAction, inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Logs a session the signed-in mentor held, through the website's own
 * `logSession`: the same checks, in the same words.
 *
 * Its refusals come back as they are, and they tell an unknown student from one
 * who is not the mentor's, as the website's form does. The id is unguessable
 * and the wording is the action's, so it stays as it is. Going over the hours
 * or past the use-by is not a refusal: the action logs it and says so in its
 * message, and asking first is the app's job.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const body = await bodyOf(request);
  if (!body) return refused("Send the session as JSON.", 400);
  const form = logForm(body);
  if (!(form instanceof FormData)) return refused("That isn't a valid value.", 400, { field: form.field });
  return fromAction(await logSession(null, form));
}
