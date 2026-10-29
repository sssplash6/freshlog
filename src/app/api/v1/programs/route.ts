import { createProgram } from "@/lib/actions/programs";
import { programRows, schoolOf } from "@/lib/api/v1/admin";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { isText } from "@/lib/api/v1/session-forms";
import { scopeIsEmpty } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The programs the reader reads, as rows, in the admin home's order
 * (`programRows`). A reader with none is answered like a page that does not
 * exist.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const reader = await readerFor(user);
  if (scopeIsEmpty(reader.read)) return refused("Not found.", 404);
  return ok(programRows(reader, await schoolOf(reader)));
}

/**
 * A new program, through the website's `createProgram`. It arrives with nobody
 * administering it, so only a platform admin, who hands out that access, makes
 * one; to anyone else the route does not exist. No id comes back: the app reads
 * the list again.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  if (!user.platformAdmin) return refused("Not found.", 404);
  const body = await bodyOf(request);
  if (!body) return refused("Send the program as JSON.", 400);
  if (!isText(body.name)) return refused("That isn't a valid value.", 400, { field: "name" });
  const form = new FormData();
  form.set("name", body.name);
  return fromAction(await createProgram(null, form));
}
