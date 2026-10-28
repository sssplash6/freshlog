import { editInterviewFeedback, saveInterviewFeedback } from "@/lib/actions/interviews";
import { bodyOf } from "@/lib/api/v1/body";
import { interviewWrite } from "@/lib/api/v1/interview";
import { feedbackForm } from "@/lib/api/v1/practice-forms";
import { inactive, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** A draft of my feedback, which only I read until it is sent: `saveInterviewFeedback`. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  return interviewWrite(user, id, feedbackForm(await bodyOf(request)), (form) => saveInterviewFeedback(null, form));
}

/**
 * A correction to feedback already sent, until 30 minutes after the interview
 * ends: `editInterviewFeedback`. The partner reads the new words in place.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  return interviewWrite(user, id, feedbackForm(await bodyOf(request), "save"), (form) => editInterviewFeedback(null, form));
}
