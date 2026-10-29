import { correctUniversityWords } from "@/lib/actions/applications";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import type { WordsCorrection } from "@/lib/api/v1/types";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Corrects a university's supplemental word count for every student who lists
 * it (`correctUniversityWords`): an admin of a program that tracks
 * admissions, whom the action alone decides.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { words } = ((await bodyOf(request)) ?? {}) as Partial<Record<keyof WordsCorrection, unknown>>;
  if (!Number.isInteger(words) || (words as number) < 0) return refused("That isn't a valid value.", 400, { field: "words" });
  const form = new FormData();
  form.set("universityId", (await params).id);
  form.set("words", String(words));
  return fromAction(await correctUniversityWords(null, form));
}
