import { deleteCohort } from "@/lib/actions/programs";
import { programGate } from "@/lib/api/v1/programs";
import { fromAction, inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Deletes a cohort, through the website's `deleteCohort`, which refuses while
 * anyone is in it. Gated by its program first, so one in a program the reader
 * does not read is answered like one that does not exist.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const cohort = await prisma.cohort.findUnique({ where: { id: (await params).id }, select: { id: true, programId: true } });
  if (!cohort) return refused("Not found.", 404);
  const gate = await programGate(await readerFor(user), cohort.programId, { write: true });
  if ("refusal" in gate) return gate.refusal;
  const form = new FormData();
  form.set("cohortId", cohort.id);
  return fromAction(await deleteCohort(null, form));
}
