import { setMentorAllocation } from "@/lib/actions/students";
import { programRefusal } from "@/lib/api/v1/admin-gates";
import { managedStudent } from "@/lib/api/v1/admin-student";
import { bodyOf } from "@/lib/api/v1/body";
import { grantForm } from "@/lib/api/v1/grant-forms";
import { grantOptionsFor } from "@/lib/api/v1/grants";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Gives a student time, or sets a grant to a total, through the website's
 * `setMentorAllocation`: with a mentor, into the unassigned pool, into the
 * hour bank, or as a share of the bank. Its refusals and its sentence are the
 * website's.
 *
 * The program is gated first (`programRefusal`), and the body is held to what
 * `GET grant-options` offers, each bad value refused on its field, since the
 * action names none.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { id } = await params;
  const reader = await readerFor(user);
  const managed = await managedStudent(reader, id);
  if (!managed) return refused("Not found.", 404);
  const body = await bodyOf(request);
  if (!body) return refused("Send the grant as JSON.", 400);
  const gate = programRefusal(reader, body.program);
  if (gate) return gate;
  const form = grantForm(id, body, await grantOptionsFor(reader, managed.profile));
  if (!(form instanceof FormData)) return refused("That isn't a valid value.", 400, { field: form.field });
  return fromAction(await setMentorAllocation(null, form));
}
