import { removeStudentUniversity, setPrimaryUniversity } from "@/lib/actions/applications";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import type { PrimaryChoice } from "@/lib/api/v1/types";
import { isRound } from "@/lib/applications";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; rowId: string }> };

/** Makes a university on the list the primary choice, with its round or none (`setPrimaryUniversity`). */
export async function PATCH(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { round } = ((await bodyOf(request)) ?? {}) as Partial<Record<keyof PrimaryChoice, unknown>>;
  if (round !== null && round !== undefined && !isRound(round)) return refused("That isn't a valid value.", 400, { field: "round" });
  const { id, rowId } = await params;
  const form = new FormData();
  form.set("studentProfileId", id);
  form.set("id", rowId);
  form.set("round", typeof round === "string" ? round : "");
  return fromAction(await setPrimaryUniversity(null, form));
}

/** Takes a university off the list, with its supplemental's stage (`removeStudentUniversity`). */
export async function DELETE(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { id, rowId } = await params;
  const form = new FormData();
  form.set("studentProfileId", id);
  form.set("id", rowId);
  return fromAction(await removeStudentUniversity(null, form));
}
