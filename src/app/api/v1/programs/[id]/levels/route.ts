import { createLevel } from "@/lib/actions/programs";
import { bodyOf } from "@/lib/api/v1/body";
import { programGate } from "@/lib/api/v1/programs";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { isText } from "@/lib/api/v1/session-forms";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** A new level in the program, through the website's `createLevel`, which refuses one beside flat cohorts. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const gate = await programGate(await readerFor(user), (await params).id, { write: true });
  if ("refusal" in gate) return gate.refusal;
  const body = await bodyOf(request);
  if (!body) return refused("Send the level as JSON.", 400);
  if (!isText(body.name)) return refused("That isn't a valid value.", 400, { field: "name" });
  const form = new FormData();
  form.set("programId", gate.program.id);
  form.set("name", body.name);
  return fromAction(await createLevel(null, form));
}
