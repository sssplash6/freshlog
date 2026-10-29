import { setEssayStage } from "@/lib/actions/applications";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import type { EssayStageChange } from "@/lib/api/v1/types";
import { isEssayStage } from "@/lib/applications";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Moves an essay to a stage (`setEssayStage`): the motivational essay
 * (`target` "essay") or one university's supplemental (its row's id), which
 * the action asks of the row's own student.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { target, stage } = ((await bodyOf(request)) ?? {}) as Partial<Record<keyof EssayStageChange, unknown>>;
  if (typeof target !== "string" || !target) return refused("That isn't a valid value.", 400, { field: "target" });
  if (!isEssayStage(stage)) return refused("That isn't a valid value.", 400, { field: "stage" });
  const form = new FormData();
  form.set("studentProfileId", (await params).id);
  form.set("target", target);
  form.set("stage", stage);
  return fromAction(await setEssayStage(null, form));
}
