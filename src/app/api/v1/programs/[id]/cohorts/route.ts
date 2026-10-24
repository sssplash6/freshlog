import { createCohort } from "@/lib/actions/programs";
import { bodyOf } from "@/lib/api/v1/body";
import { programGate } from "@/lib/api/v1/programs";
import { fromAction, inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { isText } from "@/lib/api/v1/session-forms";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * A new cohort, through the website's `createCohort`: under one of the
 * program's levels where it has them, which the action asks for, or flat.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const gate = await programGate(await readerFor(user), (await params).id, { write: true });
  if ("refusal" in gate) return gate.refusal;
  const body = await bodyOf(request);
  if (!body) return refused("Send the cohort as JSON.", 400);
  if (!isText(body.name)) return refused("That isn't a valid value.", 400, { field: "name" });
  if (body.level !== undefined && !isText(body.level)) return refused("That isn't a valid value.", 400, { field: "level" });
  const form = new FormData();
  form.set("programId", gate.program.id);
  form.set("name", body.name);
  if (isText(body.level)) form.set("levelId", body.level);
  return fromAction(await createCohort(null, form));
}
