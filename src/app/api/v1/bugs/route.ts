import { reportBug } from "@/lib/actions/bugs";
import { multipartOf } from "@/lib/api/v1/account-forms";
import { bugsFor } from "@/lib/api/v1/bug-view";
import { fromCreatingAction, inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** Bug reports: yours, then what was fixed for everybody. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  return ok(await bugsFor(user));
}

/**
 * Report a bug: `reportBug`, with the request's multipart body as its form
 * ("title", "description", and a file "screenshot" if there is one). It
 * redirects to the report it filed, and the answer is that report's id. The
 * page it was sent from is the website's to say; the app has none, so "from"
 * is dropped rather than trusted.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const form = await multipartOf(request);
  if (!form) return refused("Send the report as multipart/form-data.", 400);
  form.delete("from");
  return fromCreatingAction(() => reportBug(null, form), "/bugs/");
}
