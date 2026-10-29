import { setWeeklyDigest } from "@/lib/actions/email-prefs";
import { digestForm } from "@/lib/api/v1/account-forms";
import { bodyOf } from "@/lib/api/v1/body";
import { inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import type { WriteResult } from "@/lib/api/v1/types";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** The Monday email, on or off: `setWeeklyDigest`, which answers nothing. */
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const form = digestForm(await bodyOf(request));
  if (!(form instanceof FormData)) return refused(form.error, 400, { field: form.field });
  await setWeeklyDigest(form);
  return ok({ ok: true } satisfies WriteResult);
}
