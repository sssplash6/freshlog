import { setOwnTelegram } from "@/lib/actions/profile";
import { onField, telegramForm } from "@/lib/api/v1/account-forms";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Your Telegram handle: `setOwnTelegram`. A student's alone; anyone else is
 * told so in the action's words. There is no clearing one: the action asks
 * for a handle every time.
 */
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const form = telegramForm(await bodyOf(request));
  if (!(form instanceof FormData)) return refused(form.error, 400, { field: form.field });
  return fromAction(onField(await setOwnTelegram(null, form), "telegram"));
}
