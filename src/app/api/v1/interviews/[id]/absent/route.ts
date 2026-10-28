import { markPartnerAbsent } from "@/lib/actions/interviews";
import { interviewWrite } from "@/lib/api/v1/interview";
import { emptyForm } from "@/lib/api/v1/practice-forms";
import { inactive, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Say the partner did not join: `markPartnerAbsent`. It closes the interview
 * for both, and the partner is told.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  return interviewWrite(user, id, emptyForm(), (form) => markPartnerAbsent(null, form));
}
