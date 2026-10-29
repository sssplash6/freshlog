import { saveApplicationSnapshot } from "@/lib/actions/applications";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import type { ApplicationSnapshot } from "@/lib/api/v1/types";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The application's SAT, IELTS, school and GPA, saved together as the
 * website's form saves them (`saveApplicationSnapshot`): an empty one clears
 * it, and the action reads and checks each, in its words.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const body = ((await bodyOf(request)) ?? {}) as Partial<Record<keyof ApplicationSnapshot, unknown>>;
  const form = new FormData();
  form.set("studentProfileId", (await params).id);
  for (const field of ["sat", "ielts", "school", "gpa"] as const) {
    const value = body[field] ?? "";
    if (typeof value !== "string") return refused("That isn't a valid value.", 400, { field });
    form.set(field, value);
  }
  return fromAction(await saveApplicationSnapshot(null, form));
}
