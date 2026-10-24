import { createStudents } from "@/lib/actions/students";
import { addStudentsForm } from "@/lib/api/v1/add-students";
import { bodyOf } from "@/lib/api/v1/body";
import { programGate } from "@/lib/api/v1/programs";
import { fromAction, inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Adds students to the program, one request for every row, through the
 * website's `createStudents`. An address already somebody's, or a name of one
 * word, is skipped and named in its message; when every row is skipped it is a
 * refusal. Class groups are the website's own form.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const gate = await programGate(await readerFor(user), (await params).id, { write: true });
  if ("refusal" in gate) return gate.refusal;
  const body = await bodyOf(request);
  if (!body) return refused("Send the students as JSON.", 400);
  const form = await addStudentsForm(gate.program, body);
  if ("classHours" in form) return refused("Add class groups on the website.", 400);
  if (!(form instanceof FormData)) return refused("That isn't a valid value.", 400, { field: form.field });
  return fromAction(await createStudents(null, form));
}
