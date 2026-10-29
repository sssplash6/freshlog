import { studentRecordFor } from "@/lib/api/v1/admin-student";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * One student as the website's `/students/[id]` shows them to the reader: an
 * admin of one of their programs, or a mentor who reaches them
 * (`studentRecordFor`). `?as=mentor` reads it in the mentor's lens, as the
 * app's mentor side does. Anyone else, and a student who does not exist, is
 * answered alike.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id } = await params;
  const mentorLens = new URL(request.url).searchParams.get("as") === "mentor";
  const student = await studentRecordFor(await readerFor(user), id, { mentors: true, mentorLens });
  if (!student) return refused("Not found.", 404);
  return ok(student);
}
