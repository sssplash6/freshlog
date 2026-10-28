import { logMentorsFor } from "@/lib/api/v1/log";
import { inactive, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { scopeIsEmpty } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Who an admin may log a session for: the mentors of the programs they may
 * change (`logMentorsFor`), narrowed to one with `?program=`. A reader who may
 * change no program logs for nobody but themselves, and is answered like a
 * page that does not exist.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const reader = await readerFor(user);
  if (scopeIsEmpty(reader.write)) return refused("Not found.", 404);
  const program = new URL(request.url).searchParams.get("program")?.trim() || undefined;
  return ok(await logMentorsFor(reader, program));
}
