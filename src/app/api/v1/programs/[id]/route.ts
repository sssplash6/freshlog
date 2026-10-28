import { deleteProgram } from "@/lib/actions/programs";
import { bodyOf } from "@/lib/api/v1/body";
import { programEditOf } from "@/lib/api/v1/program-forms";
import { programDetailFor, programGate } from "@/lib/api/v1/programs";
import { fromAction, fromRedirectingAction, inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * One program, its settings and who works in it (`programDetailFor`), to
 * anyone who reads it. A program they do not read is answered like one that
 * does not exist.
 */
export async function GET(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const reader = await readerFor(user);
  const gate = await programGate(reader, (await params).id, { write: false });
  if ("refusal" in gate) return gate.refusal;
  return ok(await programDetailFor(reader, gate.program));
}

/**
 * Changes one setting, through the action the website's Settings page calls
 * for it (`programEditOf`). Turning admissions or scheduled classes on is a
 * platform admin's; turning them off is the program's own call.
 */
export async function PATCH(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const reader = await readerFor(user);
  const gate = await programGate(reader, (await params).id, { write: true });
  if ("refusal" in gate) return gate.refusal;
  const body = await bodyOf(request);
  if (!body) return refused("Send the change as JSON.", 400);
  const edit = programEditOf(gate.program.id, body);
  if ("count" in edit) return refused("Change one setting at a time.", 400);
  if ("field" in edit) return refused("That isn't a valid value.", 400, { field: edit.field });
  if (edit.platformOnly && !user.platformAdmin) return refused("Only a platform admin can turn that on.", 403);
  return fromAction(await edit.action(null, edit.form));
}

/**
 * Deletes a program, through the website's `deleteProgram`, which refuses while
 * it has students or anyone administers it, and redirects when it is done
 * (`fromRedirectingAction`). The grant rule makes it a platform admin's in
 * practice, so it is one here: to anyone else the program is not theirs to
 * delete, in a 403, when they read it.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const reader = await readerFor(user);
  const gate = await programGate(reader, (await params).id, { write: true });
  if ("refusal" in gate) return gate.refusal;
  if (!user.platformAdmin) return refused("Only a platform admin can delete a program.", 403);
  const form = new FormData();
  form.set("programId", gate.program.id);
  return fromRedirectingAction(() => deleteProgram(null, form));
}
