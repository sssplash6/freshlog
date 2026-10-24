import { inboxPage, inboxQueryFrom } from "@/lib/api/v1/inbox";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The signed-in person's notifications, newest first, a page at a time
 * (`?cursor=&limit=`), with how many of the whole feed are unread.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const page = await inboxPage(user.id, inboxQueryFrom(new URL(request.url).searchParams));
  if ("refused" in page) return refused(page.refused, 400, { field: page.field });
  return ok(page);
}
