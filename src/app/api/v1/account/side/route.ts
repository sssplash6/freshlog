import { setProfile } from "@/lib/actions/profile";
import { sideForm } from "@/lib/api/v1/account-forms";
import { bodyOf } from "@/lib/api/v1/body";
import { inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import type { WriteResult } from "@/lib/api/v1/types";
import { getCurrentUser } from "@/lib/dal";
import { canSwitchProfile } from "@/lib/profile";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The side the app is on, for somebody with two: `setProfile`, the website's
 * own switch, which keeps it on the account, so the website opens on it too.
 * The action is silent when it refuses; this says so instead.
 */
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  if (!(await canSwitchProfile(user))) return refused("You have one side.", 403);
  const form = sideForm(user, await bodyOf(request));
  if (!(form instanceof FormData)) return refused(form.error, 400, { field: form.field });
  await setProfile(form);
  return ok({ ok: true } satisfies WriteResult);
}
