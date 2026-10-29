import { classmateFor } from "@/lib/api/v1/classmates";
import { capacityOf, NOT_A_STUDENT, practiceViewer } from "@/lib/api/v1/practice";
import { inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * A classmate's page: who they are, the programs the two share, and the times
 * they offer. Somebody who is not a classmate and somebody who does not exist
 * are the same 404 (`classmateFor`).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  // `?as=mentor`: a student's people page as a mentor reads it (the student's times for their mentors).
  const me = practiceViewer(user, capacityOf(new URL(request.url).searchParams.get("as")));
  if (!me) return refused(NOT_A_STUDENT, 403);
  const { id } = await params;
  const classmate = await classmateFor(me, id);
  if (!classmate) return refused("Not found.", 404);
  return ok(classmate);
}
