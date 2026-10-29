import { markAllNotificationsRead } from "@/lib/actions/notifications";
import { inactive, mayUse, noContent, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** Marks every notification of the signed-in person read, through the website's own action. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  await markAllNotificationsRead();
  return noContent();
}
