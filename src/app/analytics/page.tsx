import type { Metadata } from "next";

import { analyticsData } from "@/lib/analytics";
import { ROLES } from "@/lib/constants";
import { requireRole } from "@/lib/dal";
import { programWallClock } from "@/lib/when";

import { Dashboard } from "./dashboard";

export const metadata: Metadata = { title: "Analytics · freshlog" };

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
export default async function AnalyticsPage() {
  await requireRole(
    ROLES.ADMIN,
    ROLES.DEPT_LEADER,
    ROLES.SALES,
    ROLES.MENTOR
  );
  const data = await analyticsData(undefined);
  const today = programWallClock(new Date());

  return (
    <Dashboard
      data={data}
      today={{
        year: today.getUTCFullYear(),
        month: today.getUTCMonth(),
        day: today.getUTCDate(),
      }}
    />
  );
}
