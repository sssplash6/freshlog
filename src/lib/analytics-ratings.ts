import "server-only";

import type { AnalyticsData } from "@/lib/analytics";
import { adminScope, adminWriteScope } from "@/lib/authz";
import { feedbackWhere, meetingRatingsWhere } from "@/lib/filters";
import { prisma } from "@/lib/prisma";
import { readablePrograms } from "@/lib/screens/feedback";
import { programWallClock } from "@/lib/when";
import type { User } from "@/generated/prisma/client";

/**
 * The ratings beside a mentor's rank on Analytics (November 2026: "I should
 * also be able to see the rating at the top as well").
 *
 * The figure is `/feedback`'s Combined score — every form rating and every
 * meeting rating, pooled (`mentor-standing.ts`) — read through the SAME gate
 * and the same `where`s as that page, so the two cannot differ and nobody
 * reads a score here that `/feedback` would not show them:
 *
 *   - a reader with an ADMIN or LEADER grant reads every rating in those
 *     programs (`readablePrograms`), as the Feedback page's staff shape does;
 *   - anybody else (a mentor with no such grant, a salesperson) reads none.
 *
 * NOT A MENTOR'S OWN, unless Feedback lists it to them. This page narrows to
 * any days the reader picks, so a figure over one day is one meeting's score.
 * `/feedback` gives a mentor their meeting ratings as an average and a count
 * per star and never as rows ("not which meeting"), and reads them through no
 * date filter for exactly that reason. The first cut of this file sent a
 * mentor their own rows: Dates set to one day read "★ 5.0 · 1 rating", which
 * is the row Feedback withholds. So a mentor is sent nothing here, and a
 * staff reader's OWN rows go only when every one of their rated meetings is in
 * a program they administer — the meetings Feedback already lists to them by
 * date (`ownListed` in `screens/feedback.ts`). A leader who also mentors gets
 * colleagues' ratings and not their own.
 *
 * Only the score, its day and the programs it counts in are sent: no student,
 * no note, no comment — `lib/analytics.ts` keeps "notes, ratings and disputes"
 * on the pages that govern them, and this sends no more than the number those
 * pages already print. A form rating names no program, so, like the Feedback
 * page's Program filter, it counts in each program its writer is enrolled in;
 * a meeting rating counts in the program it was logged in.
 */

/** One rating: [mentor, day (yyyymmdd, Tashkent), score, ...program indexes]. */
export type RatingRow = [mentor: number, day: number, score: number, ...programs: number[]];

export type AnalyticsRatings = {
  /**
   * The reader's own mentor index when their ratings are left out of `rows`,
   * so their own page shows no figure rather than "No ratings"; else null.
   */
  withheld: number | null;
  rows: RatingRow[];
};

function dayOf(at: Date): number {
  const d = programWallClock(at);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

export async function analyticsRatings(
  user: User,
  data: AnalyticsData
): Promise<AnalyticsRatings | null> {
  const programIds = await readablePrograms(user, await adminScope(user));
  const staffReader = programIds === undefined || programIds.length > 0;
  if (!staffReader) return null;

  const now = new Date();
  const scope = { programIds };
  const [written, meetings] = await Promise.all([
    prisma.mentorFeedback.findMany({
      where: feedbackWhere({}, scope, now),
      select: {
        mentorId: true,
        rating: true,
        createdAt: true,
        student: { select: { enrollments: { select: { programId: true } } } },
      },
    }),
    prisma.session.findMany({
      where: meetingRatingsWhere({}, scope, now),
      select: { mentorId: true, studentRating: true, studentAnsweredAt: true, date: true, programId: true },
    }),
  ]);

  // The reader's own, only where Feedback lists every one of them by date.
  const write = await adminWriteScope(user);
  const self = meetings.every(
    (s) => s.mentorId !== user.id || write === "ALL" || write.has(s.programId)
  );
  const sent = (mentorId: string) => self || mentorId !== user.id;

  const mentorIndex = new Map(data.mentors.map((m, i) => [m.id, i]));
  const programIndex = new Map(data.programs.map((p, i) => [p.id, i]));
  const rows: RatingRow[] = [];
  for (const r of written) {
    const m = mentorIndex.get(r.mentorId);
    if (m === undefined || !sent(r.mentorId)) continue;
    const programs = [
      ...new Set(r.student.enrollments.flatMap((e) => programIndex.get(e.programId) ?? [])),
    ];
    rows.push([m, dayOf(r.createdAt), r.rating, ...programs]);
  }
  for (const s of meetings) {
    const m = mentorIndex.get(s.mentorId);
    if (m === undefined || s.studentRating === null || !sent(s.mentorId)) continue;
    const p = programIndex.get(s.programId);
    rows.push([m, dayOf(s.studentAnsweredAt ?? s.date), s.studentRating, ...(p === undefined ? [] : [p])]);
  }
  return { withheld: self ? null : (mentorIndex.get(user.id) ?? null), rows };
}
