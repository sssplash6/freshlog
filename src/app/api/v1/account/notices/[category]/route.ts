import { setNotificationPreference } from "@/lib/actions/email-prefs";
import { noticeCategory, noticeForm } from "@/lib/api/v1/account-forms";
import { bodyOf } from "@/lib/api/v1/body";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import type { WriteResult } from "@/lib/api/v1/types";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * One category's two switches: `setNotificationPreference`, which stores a
 * row only where they differ from the default. It answers nothing, so once it
 * returns the switches are saved.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ category: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const category = noticeCategory((await params).category);
  if (!category) return refused("Not found.", 404);
  const form = noticeForm(category, await bodyOf(request));
  if (!(form instanceof FormData)) return refused(form.error, 400, { field: form.field });
  await setNotificationPreference(form);
  return ok({ ok: true } satisfies WriteResult);
}
