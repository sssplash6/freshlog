import { logSession } from "@/lib/actions/sessions";
import { bodyOf } from "@/lib/api/v1/body";
import { logForm } from "@/lib/api/v1/log";
import { fromAction, inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { ledgerScope, readerFor, sessionsPage, sessionsQueryFrom } from "@/lib/api/v1/sessions";
import { adminWriteScope, scopeIsEmpty } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The signed-in person's ledger: a student's own sessions, or the ones a mentor
 * logged, a page at a time, with figures for the whole filter (`sessionsPage`).
 * `as=mentor` asks for the ones they logged, whatever else they are
 * (`ledgerScope`).
 *
 * Somebody with no such ledger to read is told what any id that isn't theirs
 * is told.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const reader = await readerFor(user);
  const query = sessionsQueryFrom(new URL(request.url).searchParams);
  if (!ledgerScope(reader, query.as)) return refused("Not found.", 404);
  const page = await sessionsPage(reader, query);
  if ("refused" in page) return refused(page.refused, 400, { field: page.field });
  return ok(page);
}

/**
 * Logs a session the signed-in mentor held, or, for an admin who names the
 * mentor, one held on that mentor's behalf, through the website's own
 * `logSession`: the same checks, in the same words. The mentor is honoured only
 * for a reader who may change some program (`logForm`).
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
  const form = logForm(body, !scopeIsEmpty(await adminWriteScope(user)));
  if (!(form instanceof FormData)) return refused("That isn't a valid value.", 400, { field: form.field });
  return fromAction(await logSession(null, form));
}
