import { restoreStatus } from "@/lib/actions/dismissals";
import { bodyOf } from "@/lib/api/v1/body";
import { mayDismiss, statusKeyFrom } from "@/lib/api/v1/dismissals";
import { inactive, noContent, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Shows a hidden To do row again, through the website's `restoreStatus`. The row returns if what it describes is still true.
 *
 * The body is a row's `type` and `subjectId` (`TodoRow.subject?.id ?? ""`).
 * A reader whose list can't hide rows is refused.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const body = await bodyOf(request);
  if (!body) return refused("Send the row as JSON.", 400);
  const key = statusKeyFrom(body);
  if ("field" in key) return refused("That isn't a valid value.", 400, { field: key.field });
  if (!(await mayDismiss(user))) return refused("Your list can't hide rows.", 400);
  const form = new FormData();
  form.set("type", key.type);
  form.set("subjectId", key.subjectId);
  await restoreStatus(form);
  return noContent();
}
