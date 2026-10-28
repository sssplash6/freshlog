import { noticeCategory, pushSwitch } from "@/lib/api/v1/account-forms";
import { bodyOf } from "@/lib/api/v1/body";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import type { WriteResult } from "@/lib/api/v1/types";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * One category's Push switch, the reader's own. On is the default, so turning
 * it back on deletes the row rather than keeping one that says the default,
 * as `setNotificationPreference` does for the in-app and email switches. Push
 * is the app's alone: the website has no switch for it, and no action.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ category: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const category = noticeCategory((await params).category);
  if (!category) return refused("Not found.", 404);
  const form = pushSwitch(await bodyOf(request));
  if (!("on" in form)) return refused(form.error, 400, { field: form.field });
  const key = { userId_category: { userId: user.id, category } };
  if (form.on) await prisma.pushPreference.deleteMany({ where: { userId: user.id, category } });
  else await prisma.pushPreference.upsert({ where: key, update: { on: false }, create: { userId: user.id, category, on: false } });
  return ok({ ok: true } satisfies WriteResult);
}
