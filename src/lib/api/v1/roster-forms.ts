import { isOneOf } from "@/lib/api/v1/session-forms";
import type { RosterQuery } from "@/lib/api/v1/types";

/**
 * The roster's query, read off a URL.
 *
 * The website's /students reads the same words (`studentsWhere`, `readTimeState`,
 * `readSort`) and drops one it doesn't know. The app is told instead, on the
 * field, so a chip that asks for something that is not there cannot quietly
 * show every student.
 */

const STATUSES = isOneOf<NonNullable<RosterQuery["status"]>>(["pending", "not-signed-in"]);
const TIMES = isOneOf<NonNullable<RosterQuery["time"]>>(["none", "expiring", "expired"]);
const SORTS = isOneOf<NonNullable<RosterQuery["sort"]>>(["student", "remaining", "deadline", "seen"]);

/** The query, or the first field that is not one of its words. A blank value is no value. */
export function rosterQueryFrom(params: URLSearchParams): RosterQuery | { field: string } {
  const text = (key: string) => {
    const value = params.get(key)?.trim();
    return value ? value : undefined;
  };
  const query: RosterQuery = { q: text("q"), program: text("program"), level: text("level"), cohort: text("cohort") };
  const status = text("status");
  if (status !== undefined) {
    if (!STATUSES(status)) return { field: "status" };
    query.status = status;
  }
  const time = text("time");
  if (time !== undefined) {
    if (!TIMES(time)) return { field: "time" };
    query.time = time;
  }
  const sort = text("sort");
  if (sort !== undefined) {
    if (!SORTS(sort)) return { field: "sort" };
    query.sort = sort;
  }
  const page = text("page");
  if (page !== undefined) {
    if (!/^\d+$/.test(page) || Number(page) < 1 || Number(page) > 10_000) return { field: "page" };
    query.page = Number(page);
  }
  return query;
}
