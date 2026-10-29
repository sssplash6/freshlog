import { addStudentUniversity } from "@/lib/actions/applications";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { isRound } from "@/lib/applications";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Puts a university on the student's list (`addStudentUniversity`): one from
 * the shared list (`university`), whose word count comes with it, or a new one
 * (`name` and its supplemental `words`, entered once for everybody). As the
 * primary choice if `primary`, with its `round` if any.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const body = (await bodyOf(request)) ?? {};
  const { university, name, words, primary, round } = body as Record<string, unknown>;
  const form = new FormData();
  form.set("studentProfileId", (await params).id);
  if (typeof university === "string" && university) form.set("universityId", university);
  else if (typeof name === "string" && Number.isInteger(words)) {
    form.set("newName", name);
    form.set("words", String(words));
  } else return refused("Pick a university, or name a new one with its word count.", 400, { field: typeof name === "string" ? "words" : "university" });
  if (primary !== undefined && typeof primary !== "boolean") return refused("That isn't a valid value.", 400, { field: "primary" });
  if (round !== undefined && !isRound(round)) return refused("That isn't a valid value.", 400, { field: "round" });
  if (primary) form.set("primary", "on");
  if (round) form.set("round", round);
  return fromAction(await addStudentUniversity(null, form));
}
