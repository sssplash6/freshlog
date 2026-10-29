import { assignMentorToProgram } from "@/lib/actions/mentors";
import { bodyOf } from "@/lib/api/v1/body";
import { programGate } from "@/lib/api/v1/programs";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { isText } from "@/lib/api/v1/session-forms";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Pairs a mentor with the program, or one of its levels or cohorts, through the
 * website's `assignMentorToProgram`, which tells them. Pairing them twice the
 * same way is not a refusal: the action says they are already assigned.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const gate = await programGate(await readerFor(user), (await params).id, { write: true });
  if ("refusal" in gate) return gate.refusal;
  const body = await bodyOf(request);
  if (!body) return refused("Send the mentor as JSON.", 400);
  for (const field of ["level", "cohort"] as const) {
    if (body[field] !== undefined && !isText(body[field])) return refused("That isn't a valid value.", 400, { field });
  }
  if (!isText(body.mentor) || !body.mentor) return refused("That isn't a valid value.", 400, { field: "mentor" });
  const form = new FormData();
  form.set("programId", gate.program.id);
  form.set("mentorId", body.mentor);
  if (isText(body.level)) form.set("levelId", body.level);
  if (isText(body.cohort)) form.set("cohortId", body.cohort);
  return fromAction(await assignMentorToProgram(null, form));
}
