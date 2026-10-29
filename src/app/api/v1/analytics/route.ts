import { inactive, mayUse, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import type { ApiAnalytics } from "@/lib/api/v1/types";
import { analyticsData, instituteAnalyticsData } from "@/lib/analytics";
import { canActAsMentor, ROLES } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";
import { profileFrom } from "@/lib/profile";
import { spaceOf } from "@/lib/space";
import { programToday } from "@/lib/when";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** The roles /analytics lets in (`requireRole`): students are turned away. */
const READERS: string[] = [ROLES.ADMIN, ROLES.DEPT_LEADER, ROLES.SALES, ROLES.MENTOR];

/**
 * Analytics, as /analytics reads it: deliberately unscoped (mentor names and
 * hours, never a student), framed by the reader's space, an institute's levels
 * when that is their whole work, else the school, `?frame=school` for the
 * school either way. The drilling is the app's, over these rows, as the
 * website's is the browser's. `?as=mentor` or `?as=admin` is the side the app
 * is on, which the website keeps in its cookie (`profileFrom`): a person who
 * both mentors and administers reads their own analytics as a mentor.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  if (!READERS.includes(user.role)) return refused("Not found.", 404);

  const params = new URL(request.url).searchParams;
  const lens = await profileFrom(user, params.get("as"));
  const asMentor = lens === "mentor" && canActAsMentor(user);
  const space = await spaceOf(user, lens);
  const wantsSchool = params.get("frame") === "school";
  const inInstitute = space.kind === "institute" && !wantsSchool;
  const data = inInstitute ? await instituteAnalyticsData(space.programId) : await analyticsData(undefined);

  return ok({
    audience: asMentor ? "mentor" : "staff",
    self: asMentor ? user.id : null,
    frame: inInstitute ? { kind: "institute", name: space.name } : { kind: "school" },
    other: space.kind !== "institute" ? null : inInstitute ? { label: "Whole school", school: true } : { label: space.name, school: false },
    today: programToday(new Date()),
    programs: data.programs.map((p) => ({ id: p.id, name: p.name, colorIndex: p.colorIndex, archived: p.archived, granted: p.granted })),
    mentors: data.mentors.map((m) => ({ id: m.id, name: m.name })),
    sessions: data.rows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5]]),
  } satisfies ApiAnalytics);
}
