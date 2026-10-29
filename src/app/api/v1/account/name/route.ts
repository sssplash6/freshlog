import { updateOwnName } from "@/lib/actions/profile";
import { nameForm, onField } from "@/lib/api/v1/account-forms";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** Rename yourself: `updateOwnName`, a full name in its words. */
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const form = nameForm(await bodyOf(request));
  if (!(form instanceof FormData)) return refused(form.error, 400, { field: form.field });
  return fromAction(onField(await updateOwnName(null, form), "name"));
}
