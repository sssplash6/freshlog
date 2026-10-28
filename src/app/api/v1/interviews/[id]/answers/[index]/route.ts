import { saveInterviewAnswer } from "@/lib/actions/interviews";
import { bodyOf } from "@/lib/api/v1/body";
import { interviewWrite } from "@/lib/api/v1/interview";
import { answerForm } from "@/lib/api/v1/practice-forms";
import { inactive, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * My answer to one question, saved as the guide moves on: `saveInterviewAnswer`.
 * The latest text wins. Only while the guide is open: from the start time
 * until I send my feedback.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id, index } = await params;
  return interviewWrite(user, id, answerForm(index, await bodyOf(request)), (form) => saveInterviewAnswer(null, form));
}
