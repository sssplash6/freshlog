import { managedStudent } from "@/lib/api/v1/admin-student";
import { grantOptionsFor } from "@/lib/api/v1/grants";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * What the grant sheet offers for this student (`grantOptionsFor`). A student
 * the reader does not read is a 404, like one who does not exist; one they
 * read and may not change is a 403.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const reader = await readerFor(user);
  const managed = await managedStudent(reader, id);
  if (!managed) return refused("Not found.", 404);
  if (!managed.writes) return refused("You don't administer any program this student is in.", 403);
  return ok(await grantOptionsFor(reader, managed.profile));
}
