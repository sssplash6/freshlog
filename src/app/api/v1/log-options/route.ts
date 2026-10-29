import { logOptionsFor, onBehalfMentor } from "@/lib/api/v1/log";
import { inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { scopeProgramFilter } from "@/lib/authz";
import { canActAsMentor } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Who the signed-in mentor can log a session for, how many minutes each has
 * left with them, and what they logged last (`logOptionsFor`).
 *
 * It is for somebody who can act as a mentor. To anyone else it answers like a
 * route that does not exist, so the answer says nothing about who mentors.
 *
 * `?mentor=` is an admin logging on that mentor's behalf: the mentor's own
 * options, narrowed to the programs the admin may change. `?program=`, from a
 * program's page, narrows to the students in it. A mentor the admin
 * may not log for, and a reader who may change no program, are answered the
 * same way, as one that does not exist.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const params = new URL(request.url).searchParams;
  const named = params.get("mentor")?.trim();
  // `?program=`, from a program's page: only the students in it, as the website's log page offers them.
  const program = params.get("program")?.trim() || undefined;
  if (named) {
    const reader = await readerFor(user);
    const mentor = await onBehalfMentor(reader, named);
    if (!mentor) return refused("Not found.", 404);
    return ok(await logOptionsFor(mentor, new Date(), { programIds: scopeProgramFilter(reader.write), program }));
  }
  if (!canActAsMentor(user)) return refused("Not found.", 404);
  return ok(await logOptionsFor(user, new Date(), program ? { programIds: undefined, program } : undefined));
}
