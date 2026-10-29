import { cancelClass } from "@/lib/actions/classes";
import { fromAction, inactive, mayUse, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** Takes a class out of the diary (`cancelClass`): the mentor who booked it, or an admin of its program. The row stays, Cancelled. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const form = new FormData();
  form.set("classId", (await params).id);
  return fromAction(await cancelClass(null, form));
}
