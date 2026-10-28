import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { studentInterviewsFor } from "@/lib/api/v1/student-interviews";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * A student's practice interviews, for a mentor who has worked with them
 * (`studentInterviewsFor`). Anybody else, and a student who does not exist,
 * are answered alike.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const interviews = await studentInterviewsFor(user, id);
  if (!interviews) return refused("Not found.", 404);
  return ok(interviews);
}
