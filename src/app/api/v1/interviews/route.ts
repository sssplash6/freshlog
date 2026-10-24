import { bookInterview } from "@/lib/actions/interviews";
import { bodyOf } from "@/lib/api/v1/body";
import { NOT_A_STUDENT, practiceHomeFor, practiceStudent } from "@/lib/api/v1/practice";
import { bookForm } from "@/lib/api/v1/practice-forms";
import { fromBookingAction, inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
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

/**
 * Book a classmate's time, with the kind of interview to practise:
 * `bookInterview`. It redirects to the interview it made, and the answer is
 * that interview's id (`fromBookingAction`). A time that is taken, started,
 * not a classmate's or not there is refused alike, in the action's words.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  if (!(await practiceStudent(user))) return refused(NOT_A_STUDENT, 403);
  const body = await bodyOf(request);
  if (!body) return refused("Send the booking as JSON.", 400);
  const form = bookForm(body);
  if (!(form instanceof FormData)) return refused(form.error, 400, { field: form.field });
  return fromBookingAction(() => bookInterview(null, form));
}
