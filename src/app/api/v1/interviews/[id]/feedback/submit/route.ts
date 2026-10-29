import { submitInterviewFeedback } from "@/lib/actions/interviews";
import { bodyOf } from "@/lib/api/v1/body";
import { interviewWrite } from "@/lib/api/v1/interview";
import { feedbackForm } from "@/lib/api/v1/practice-forms";
import { inactive, mayUse, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Hand my feedback to the partner: `submitInterviewFeedback`. Final: it
 * completes the interview if nobody has, and the partner is told.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { id } = await params;
  return interviewWrite(user, id, feedbackForm(await bodyOf(request), "submit"), (form) => submitInterviewFeedback(null, form));
}
