import { saveInterviewNotes } from "@/lib/actions/interviews";
import { bodyOf } from "@/lib/api/v1/body";
import { interviewWrite } from "@/lib/api/v1/interview";
import { notesForm } from "@/lib/api/v1/practice-forms";
import { inactive, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** My own notes on a done interview: `saveInterviewNotes`. The partner never reads them. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  return interviewWrite(user, id, notesForm(await bodyOf(request)), (form) => saveInterviewNotes(null, form));
}
