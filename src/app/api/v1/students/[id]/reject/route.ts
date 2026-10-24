import { rejectStudent } from "@/lib/actions/students";
import { managedStudent } from "@/lib/api/v1/admin-student";
import { fromAction, inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Turns away a student who signed up, through the website's `rejectStudent`,
 * which deletes the sign-up and the account with it. There is nothing to undo
 * it with. Only a pending student with no sessions can be rejected; the action
 * says so otherwise.
 *
 * Gated as approve is: a 404 for a student the reader does not read, a 403 for
 * one they read and may not change.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const managed = await managedStudent(await readerFor(user), id);
  if (!managed) return refused("Not found.", 404);
  // Seen but not theirs to change: a Leader or Sales grant. The action's own words.
  if (!managed.writes) return refused("You don't administer any program this student is in.", 403);
  const form = new FormData();
  form.set("studentProfileId", id);
  return fromAction(await rejectStudent(null, form));
}
