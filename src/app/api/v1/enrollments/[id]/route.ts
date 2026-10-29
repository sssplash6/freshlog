import { moveStudent, unenrollStudent } from "@/lib/actions/students";
import { bodyOf } from "@/lib/api/v1/body";
import { enrollmentTargetForm } from "@/lib/api/v1/enrollment-forms";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Moves one of a student's enrolments to another program, level or cohort:
 * the website's `moveStudent`, the correction for a mis-enrolment, which moves
 * the membership and nothing else. Its form names the student too; it is the
 * enrolment's own, and the action asks of both whether the reader may.
 */
export async function PATCH(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const form = enrollmentTargetForm(await bodyOf(request));
  if (!(form instanceof FormData)) return refused("That isn't a valid value.", 400, { field: form.field });
  const { id } = await params;
  const enrollment = await prisma.studentEnrollment.findUnique({ where: { id }, select: { studentId: true } });
  form.set("enrollmentId", id);
  form.set("studentProfileId", enrollment?.studentId ?? "");
  return fromAction(await moveStudent(null, form));
}

/**
 * Takes a student off one program: the website's `unenrollStudent`, refused
 * once anything happened in it, as a session or a grant would point nowhere.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const form = new FormData();
  form.set("enrollmentId", (await params).id);
  return fromAction(await unenrollStudent(null, form));
}
