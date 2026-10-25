import { mentorRecordFor, recordPeriod } from "@/lib/api/v1/mentor-record";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * A mentor's record (`?period=30d|all`, ninety days when left out): for the
 * mentor themselves and for an admin who manages them. Anybody else, and no
 * such mentor, is the same 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const period = recordPeriod(new URL(request.url).searchParams.get("period"));
  const record = await mentorRecordFor(user, (await params).id, period);
  if (!record) return refused("Not found.", 404);
  return ok(record);
}
