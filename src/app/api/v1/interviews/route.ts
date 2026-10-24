import { practiceHomeFor, practiceStudent, NOT_A_STUDENT } from "@/lib/api/v1/practice";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The Practice tab: the student's practice interviews, the times they offer,
 * their classmates and the To do rows for them. Only an approved student
 * practises; anybody else is told so, in the actions' words.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const student = await practiceStudent(user);
  if (!student) return refused(NOT_A_STUDENT, 403);
  return ok(await practiceHomeFor(student));
}
