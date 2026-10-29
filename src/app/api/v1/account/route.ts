import { accountFor } from "@/lib/api/v1/account";
import { inactive, mayUse, ok, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Account: your picture, name, handle, booking links and notification
 * switches, as /settings shows them, with the marks the account sheet carries.
 * Always the reader's own: there is no id to ask for anybody else's.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  return ok(await accountFor(user));
}
