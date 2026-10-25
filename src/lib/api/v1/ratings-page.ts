import "server-only";

import type { ApiRatings } from "@/lib/api/v1/types";
import { nameOf } from "@/lib/api/v1/sessions";
import { adminScope, adminWriteScope, staffLevel, type AdminScope } from "@/lib/authz";
import { PAGE_SIZE, parsePage } from "@/components/ui/pagination";
import { canActAsMentor } from "@/lib/constants";
import { feedbackWhere, readParam, type SearchParams } from "@/lib/filters";
import { prisma } from "@/lib/prisma";
import { programToday } from "@/lib/when";
import type { User } from "@/generated/prisma/client";

/** /feedback's own thresholds: a mentor under this average, or one rating this low in 30 days, is "low". */
const LOW_AVERAGE = 3.5;
const LOW_RATING = 2;
const RECENT_DAYS = 30;

const dayOf = programToday;

/**
 * The programs whose ratings this person may read: /feedback's
 * `readablePrograms`, which the page keeps to itself, said again here (owner
 * decision 5: ADMIN and LEADER grants read feedback, a SALES grant doesn't).
 * `undefined` is every program.
 */
async function readablePrograms(user: User, scope: AdminScope): Promise<readonly string[] | undefined> {
  if (scope === "ALL") return undefined;
  const ids = [...scope];
  const levels = await Promise.all(ids.map((id) => staffLevel(user, id)));
  return ids.filter((_, i) => levels[i] === "ADMIN" || levels[i] === "LEADER");
}

/**
 * The Ratings page, read as /feedback reads it, or null for a reader it would
 * send home (a student, staff with no readable grant who doesn't mentor).
 *
 * Staff: every rating in reach, the mentors table worst first and the newest
 * ratings; the student is named only where the reader administers one of the
 * writer's programs (ADMIN grants), as the page decides per row. A mentor with
 * no readable grant: their own ratings, the student never selected.
 */
export async function ratingsPageFor(user: User, params: SearchParams, now = new Date()): Promise<ApiRatings | null> {
  const page = parsePage(readParam(params, "page"));
  const programIds = await readablePrograms(user, await adminScope(user));
  const staffReader = programIds === undefined || programIds.length > 0;

  if (!staffReader) {
    if (!canActAsMentor(user)) return null;
    const where = { mentorId: user.id };
    const [rows, stats] = await Promise.all([
      prisma.mentorFeedback.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: { id: true, rating: true, comment: true, createdAt: true },
      }),
      prisma.mentorFeedback.aggregate({ where, _avg: { rating: true }, _count: true }),
    ]);
    return {
      kind: "own",
      average: stats._avg.rating,
      count: stats._count,
      ratings: rows.map((f) => ({ id: f.id, rating: f.rating, comment: f.comment, sentOn: dayOf(f.createdAt), mentor: null, student: null })),
      page,
      pageSize: PAGE_SIZE,
    };
  }

  const where = feedbackWhere(params, { programIds, userId: user.id }, now);
  const inReach = feedbackWhere({}, { programIds, userId: user.id }, now);
  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const PERSON = { id: true, name: true, email: true } as const;

  const [stats, byMentor, lately, rows, rated, writeScope] = await Promise.all([
    prisma.mentorFeedback.aggregate({ where, _avg: { rating: true }, _count: true }),
    prisma.mentorFeedback.groupBy({
      by: ["mentorId"],
      where,
      _avg: { rating: true },
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: [{ _avg: { rating: "asc" } }, { _count: { mentorId: "desc" } }],
    }),
    prisma.mentorFeedback.groupBy({ by: ["mentorId"], where: { AND: [where, { createdAt: { gte: since } }] }, _min: { rating: true } }),
    prisma.mentorFeedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        mentor: { select: PERSON },
        student: { select: { user: { select: PERSON }, enrollments: { select: { programId: true } } } },
      },
    }),
    prisma.user.findMany({ where: { mentorFeedback: { some: inReach } }, select: PERSON }),
    adminWriteScope(user),
  ]);

  const person = new Map(rated.map((m) => [m.id, m]));
  const lowestRecent = new Map(lately.map((r) => [r.mentorId, r._min.rating]));
  const names = writeScope === "ALL" ? () => true : (enrolled: readonly { programId: string }[]) => enrolled.some((e) => writeScope.has(e.programId));

  return {
    kind: "staff",
    average: stats._avg.rating,
    count: stats._count,
    mentors: byMentor.flatMap((row) => {
      const who = person.get(row.mentorId);
      if (!who) return [];
      const average = row._avg.rating ?? 0;
      const recent = lowestRecent.get(row.mentorId) ?? null;
      return [
        {
          mentor: { id: who.id, name: nameOf(who) },
          average,
          count: row._count._all,
          lastRatedOn: row._max.createdAt ? dayOf(row._max.createdAt) : null,
          lowestRecent: recent,
          low: average < LOW_AVERAGE || (recent !== null && recent <= LOW_RATING),
        },
      ];
    }),
    ratings: rows.map((f) => ({
      id: f.id,
      rating: f.rating,
      comment: f.comment,
      sentOn: dayOf(f.createdAt),
      mentor: { id: f.mentor.id, name: nameOf(f.mentor) },
      student: names(f.student.enrollments) ? { id: f.student.user.id, name: nameOf(f.student.user) } : null,
    })),
    page,
    pageSize: PAGE_SIZE,
  };
}
