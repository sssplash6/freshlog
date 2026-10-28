import { approveStudent } from "@/lib/actions/students";
import { managedStudent } from "@/lib/api/v1/admin-student";
import { fromAction, inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Lets a student who signed up in, through the website's `approveStudent`: the
 * account goes ACTIVE, they are told, and every program they are in gives its
 * standard time. Approving somebody already approved is not a refusal: the
 * action answers ok with "This student is already approved.", and that is the
 * sentence the app shows.
 *
 * A student the reader does not read is a 404, like one who does not exist; one
 * they read and may not change (a Leader or Sales grant) is a 403, in the
 * action's words. The action would call the first "not found" and the second
 * "you don't administer", which tells them apart.
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
  return fromAction(await approveStudent(null, form));
}
