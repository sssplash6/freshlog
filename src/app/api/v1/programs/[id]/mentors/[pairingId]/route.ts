import { removeAssignment } from "@/lib/actions/mentors";
import { programGate } from "@/lib/api/v1/programs";
import { fromAction, inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Takes one pairing off the program, through the website's `removeAssignment`.
 * It leaves the mentor's grants and tasks as they are. A pairing of another
 * program is answered like one that does not exist.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; pairingId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { id, pairingId } = await params;
  const gate = await programGate(await readerFor(user), id, { write: true });
  if ("refusal" in gate) return gate.refusal;
  const pairing = await prisma.mentorAssignment.findFirst({ where: { id: pairingId, programId: id }, select: { id: true } });
  if (!pairing) return refused("Not found.", 404);
  const form = new FormData();
  form.set("assignmentId", pairing.id);
  return fromAction(await removeAssignment(null, form));
}
