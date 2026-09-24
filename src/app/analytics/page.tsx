import type { Metadata } from "next";

import { analyticsData } from "@/lib/analytics";
import { adminScope, scopeProgramFilter } from "@/lib/authz";
import { requireAdminAccess } from "@/lib/dal";
import { programWallClock } from "@/lib/when";

import { Dashboard } from "./dashboard";

export const metadata: Metadata = { title: "Analytics · freshlog" };

/**
 * Hours over time: the school, then one program, then one mentor, each by
 * month and — inside a month — by day.
 *
 * Every program the reader administers and none they do not: the same scope
 * every other staff page reads (`adminScope`), applied to the SESSION's own
 * program, so a mentor who works in two programs shows an admin of one of them
 * only that program's hours.
 *
 * All the drilling happens in the browser over one read. The URL carries the
 * position (`?y=&m=&p=&u=`) so a view can be shared and the back button walks
 * back up the levels.
 */
export default async function AnalyticsPage() {
  const user = await requireAdminAccess();
  const scope = await adminScope(user);
  const data = await analyticsData(scopeProgramFilter(scope));
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
