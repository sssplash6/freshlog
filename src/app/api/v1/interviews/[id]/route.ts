import { interviewFor } from "@/lib/api/v1/interview";
import { anyPracticeViewer, NOT_A_STUDENT } from "@/lib/api/v1/practice";
import { inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * One of my practice interviews: when, with whom, the questions, my answers,
 * notes and feedback, the partner's feedback once sent, and what I may do now.
 * One I am not in and one that does not exist are the same 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const me = anyPracticeViewer(user);
  if (!me) return refused(NOT_A_STUDENT, 403);
  const { id } = await params;
  const interview = await interviewFor(me, id);
  if (!interview) return refused("Not found.", 404);
  return ok(interview);
}
