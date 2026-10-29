import { parsePage } from "@/components/ui/pagination";
import { interviewPrepFor } from "@/lib/api/v1/interview-prep";
import { inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Interview prep, as the website's /interviews reads it: the practice of the
 * students in the reader's programs, who and when only. Anybody who
 * administers no program is answered like a page that does not exist.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const prep = await interviewPrepFor(user, parsePage(new URL(request.url).searchParams.get("page") ?? undefined));
  if (!prep) return refused("Not found.", 404);
  return ok(prep);
}
