import { createStudents } from "@/lib/actions/students";
import { addStudentsForm } from "@/lib/api/v1/add-students";
import { bodyOf } from "@/lib/api/v1/body";
import { programGate } from "@/lib/api/v1/programs";
import { fromAction, inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { programRosterFor } from "@/lib/api/v1/roster";
import { rosterQueryFrom } from "@/lib/api/v1/roster-forms";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The program page's roster: its students with their figures in this program,
 * the page's filters, order and paging (`programRosterFor`, through the page's
 * own `programRoster`).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const reader = await readerFor(user);
  const gate = await programGate(reader, (await params).id, { write: false });
  if ("refusal" in gate) return gate.refusal;
  const query = rosterQueryFrom(new URL(request.url).searchParams);
  if ("field" in query) return refused("That isn't a valid value.", 400, { field: query.field });
  return ok(await programRosterFor(gate.program, reader, query));
}

/**
 * Adds students to the program, one request for every row, through the
 * website's `createStudents`. An address already somebody's, a name of one word
 * or none, or an address that isn't one, is skipped and named in its message, so
 * the complete rows are added as on the website; when every row is skipped it is
 * a refusal. Class groups are the website's own form.
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
  if ("tooMany" in form) return refused(`Add up to ${form.tooMany.toLocaleString("en-US")} students at a time.`, 400, { field: "rows" });
  if (!(form instanceof FormData)) return refused("That isn't a valid value.", 400, { field: form.field });
  return fromAction(await createStudents(null, form));
}
