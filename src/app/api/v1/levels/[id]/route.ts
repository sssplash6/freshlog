import { deleteLevel, setLevelStandardHours } from "@/lib/actions/programs";
import { bodyOf } from "@/lib/api/v1/body";
import { isStandard, setStandard } from "@/lib/api/v1/program-forms";
import { programGate } from "@/lib/api/v1/programs";
import { fromAction, inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * The level, gated by its program: one in a program the reader does not read
 * is answered like one that does not exist. The actions read the row before
 * they gate it, and say "not found" for one and "you don't administer" for the
 * other, which would tell them apart.
 */
async function levelGate(user: Parameters<typeof readerFor>[0], id: string) {
  const level = await prisma.programLevel.findUnique({ where: { id }, select: { id: true, programId: true } });
  if (!level) return { refusal: refused("Not found.", 404) };
  const gate = await programGate(await readerFor(user), level.programId, { write: true });
  return "refusal" in gate ? gate : { level };
}

/** The level's standard grant, through the website's `setLevelStandardHours`. null takes the program's. */
export async function PATCH(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const gate = await levelGate(user, (await params).id);
  if ("refusal" in gate) return gate.refusal;
  const body = await bodyOf(request);
  if (!body) return refused("Send the change as JSON.", 400);
  if (!isStandard(body.standard)) return refused("That isn't a valid value.", 400, { field: "standard" });
  const form = new FormData();
  form.set("levelId", gate.level.id);
  setStandard(form, body.standard);
  return fromAction(await setLevelStandardHours(null, form));
}

/** Deletes the level, through the website's `deleteLevel`, which refuses while anyone or anything is in it. */
export async function DELETE(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const gate = await levelGate(user, (await params).id);
  if ("refusal" in gate) return gate.refusal;
  const form = new FormData();
  form.set("levelId", gate.level.id);
  return fromAction(await deleteLevel(null, form));
}
