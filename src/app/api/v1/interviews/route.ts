import { bookInterview } from "@/lib/actions/interviews";
import { bodyOf } from "@/lib/api/v1/body";
import { capacityOf, NOT_A_STUDENT, practiceHomeFor, practiceViewer } from "@/lib/api/v1/practice";
import { bookForm } from "@/lib/api/v1/practice-forms";
import { fromCreatingAction, inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The Practice tab: the student's practice interviews, the times they offer,
 * their classmates and the To do rows for them. Only an approved student
 * practises; anybody else is told so, in the actions' words.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  // `?as=mentor`: a mentor's Interviews (the website's /mentor/interviews), else a student's Practice.
  const viewer = practiceViewer(user, capacityOf(new URL(request.url).searchParams.get("as")));
  if (!viewer) return refused(NOT_A_STUDENT, 403);
  return ok(await practiceHomeFor(viewer));
}

/**
 * Book a time, with the kind of interview to practise, in the reader's capacity:
 * `bookInterview`. It redirects to the interview it made, and the answer is
 * that interview's id (`fromCreatingAction`). A time that is taken, started,
 * not a classmate's or not there is refused alike, in the action's words.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const body = await bodyOf(request);
  if (!body) return refused("Send the booking as JSON.", 400);
  // A mentor books a student's time as a mentor (`as`), and the action sends them to the mentor's interview page.
  const viewer = practiceViewer(user, capacityOf(body.as));
  if (!viewer) return refused(NOT_A_STUDENT, 403);
  const form = bookForm(body);
  if (!(form instanceof FormData)) return refused(form.error, 400, { field: form.field });
  form.set("as", viewer.as);
  return fromCreatingAction(() => bookInterview(null, form), `${viewer.base}/`);
}
