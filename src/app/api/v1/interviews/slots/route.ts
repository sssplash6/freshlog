import { addInterviewSlot } from "@/lib/actions/interviews";
import { bodyOf } from "@/lib/api/v1/body";
import { NOT_A_STUDENT, practiceStudent } from "@/lib/api/v1/practice";
import { offerSlotForm } from "@/lib/api/v1/practice-forms";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Offer a time for a classmate to book: `addInterviewSlot`, with `day` and
 * `time` on the Tashkent clock as the website's form sends them. A time that
 * clashes with one already on the student's calendar is the action's to refuse.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  if (!(await practiceStudent(user))) return refused(NOT_A_STUDENT, 403);
  const body = await bodyOf(request);
  if (!body) return refused("Send the time as JSON.", 400);
  const form = offerSlotForm(body, new Date());
  if (!(form instanceof FormData)) return refused(form.error, 400, { field: form.field });
  return fromAction(await addInterviewSlot(null, form));
}
