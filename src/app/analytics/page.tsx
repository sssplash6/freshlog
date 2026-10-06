import type { Metadata } from "next";

import { analyticsData, instituteAnalyticsData } from "@/lib/analytics";
import { canActAsMentor, ROLES } from "@/lib/constants";
import { requireRole } from "@/lib/dal";
import { profileOf } from "@/lib/profile";
import { spaceOf } from "@/lib/space";
import { programWallClock } from "@/lib/when";

import { Dashboard } from "./dashboard";

export const metadata: Metadata = { title: "Analytics" };

/**
 * Hours over time: the school, then one program, then one mentor, each by
 * month and — inside a month — by day.
 *
 * Every mentor and every member of staff reads the whole school, staff past
 * their own grants. That is a decision, not a missed scope: the page carries
 * mentor names and hours, and never a student's name (`lib/analytics.ts`), so
 * there is nothing on it one program must hide from another.
 *
 * Students are turned away. Mentors' workloads are not theirs to read.
 *
 * All the drilling happens in the browser over one read. The URL carries the
 * position (`?y=&m=&p=&u=`) so a view can be shared and the back button walks
 * back up the levels.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ frame?: string | string[] }>;
}) {
  const viewer = await requireRole(
    ROLES.ADMIN,
    ROLES.DEPT_LEADER,
    ROLES.SALES,
    ROLES.MENTOR
  );
  const today = programWallClock(new Date());

  // Same rows for everyone — the read is deliberately unscoped. What changes
  // with the reader is the FRAME: a mentor lands on their own year instead of
  // the school-wide ranking, and the ranking itself loses its podium for them.
  // Staff keep both — comparing mentors is their job, not a mentor's.
  const lens = await profileOf(viewer);
  const asMentor = lens === "mentor" && canActAsMentor(viewer);

  // Somebody whose whole work is one institute starts in it, with its levels
  // where the programs would be — and keeps the school one link away, since
  // the school-wide read is everybody's (lib/space.ts). The rows are a
  // narrower read of the same ledger, never a different one.
  const space = await spaceOf(viewer, lens);
  const wantsSchool = (await searchParams).frame === "school";
  const inInstitute = space.kind === "institute" && !wantsSchool;
  const data = inInstitute
    ? await instituteAnalyticsData(space.programId)
    : await analyticsData(undefined);

  return (
    <Dashboard
      data={data}
      audience={asMentor ? "mentor" : "staff"}
      selfMentorId={asMentor ? viewer.id : undefined}
      frame={inInstitute ? { kind: "institute", name: space.name } : { kind: "school" }}
      elsewhere={
        space.kind !== "institute"
          ? undefined
          : inInstitute
            ? { label: "Whole school", href: "/analytics?frame=school" }
            : { label: space.name, href: "/analytics" }
      }
      today={{
        year: today.getUTCFullYear(),
        month: today.getUTCMonth(),
        day: today.getUTCDate(),
      }}
    />
  );
}
