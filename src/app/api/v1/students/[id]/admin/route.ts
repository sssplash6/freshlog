import { adminStudentFor } from "@/lib/api/v1/admin-student";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * One student as an admin of one of their programs reads them: their hours and
 * grants in those programs, the changes to them, and what the reader may do
 * (`adminStudentFor`). A student in none of the reader's programs and one who
 * does not exist are answered alike.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const student = await adminStudentFor(await readerFor(user), id);
  if (!student) return refused("Not found.", 404);
  return ok(student);
}
