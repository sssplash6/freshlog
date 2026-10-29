import { mentorProgramsOf } from "@/app/programs/mentor-programs";
import { inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import type { MentorProgramRow } from "@/lib/api/v1/types";
import { canActAsMentor } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * A mentor's programs, as the website's /programs lists them in the mentor
 * lens (`mentorProgramsOf`): each program they are paired in or hold time in,
 * with their students, completed and remaining there. Somebody who can't act as
 * a mentor has no such list.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  if (!canActAsMentor(user)) return refused("Not found.", 404);
  return ok<MentorProgramRow[]>(await mentorProgramsOf(user.id));
}
