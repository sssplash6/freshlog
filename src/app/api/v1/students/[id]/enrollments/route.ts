import { enrollStudent } from "@/lib/actions/students";
import { bodyOf } from "@/lib/api/v1/body";
import { enrollmentTargetForm } from "@/lib/api/v1/enrollment-forms";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { canManageStudent } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Adds a program to a student already in one: the website's `enrollStudent`,
 * gated on the program they join, for a reader who may open the student's
 * page, where Add a program is (`canManageStudent`); anybody else, and no such
 * student, the same 404.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { id } = await params;
  const student = await prisma.studentProfile.findUnique({ where: { id }, select: { enrollments: { select: { programId: true } } } });
  if (!student || !(await canManageStudent(user, student))) return refused("Not found.", 404);
  const form = enrollmentTargetForm(await bodyOf(request));
  if (!(form instanceof FormData)) return refused("That isn't a valid value.", 400, { field: form.field });
  form.set("studentProfileId", id);
  return fromAction(await enrollStudent(null, form));
}
