import "server-only";

import type { ApiRatings, RatedMentor, RatingFigures } from "@/lib/api/v1/types";
import { nameOf } from "@/lib/api/v1/sessions";
import { adminScope } from "@/lib/authz";
import { PAGE_SIZE, parsePage } from "@/components/ui/pagination";
import { canActAsMentor } from "@/lib/constants";
import { filterSummary, readParam, readRatingKind, readRatingRange, type SearchParams } from "@/lib/filters";
import type { MentorStanding } from "@/lib/mentor-standing";
import { lowReasons, MEETING_PAGE, ownFeedback, readablePrograms, staffFeedback, tallyStars } from "@/lib/screens/feedback";
import { programToday } from "@/lib/when";
import type { User } from "@/generated/prisma/client";

const dayOf = programToday;

/** A kind of rating's count and average, as the page's figures say them. */
const figures = (k: { count: number; average: number | null }): RatingFigures => ({ count: k.count, average: k.average });

/**
 * The Feedback page, read as /feedback reads it (`ownFeedback`, `staffFeedback`,
 * the page's own reads), or null for a reader it would send home (a student,
 * staff with no readable grant who doesn't mentor).
 *
 * Staff: the combined score of written and meeting ratings, its spread, the
 * mentors who need a look and everyone else, the score per program, the newest
 * written ratings (the student named only where the reader administers one of
 * the writer's programs, and never to the mentor rated) and the newest meeting
 * ratings, through the page's filters. Never the reader's own meetings, which
 * the website lists an admin without the student's name: the app's meeting
 * line names a student on every row, so it gets none of them until it can
 * draw one without. A mentor with no
 * readable grant: their combined score, and their own written ratings,
 * anonymous.
 */
export async function ratingsPageFor(user: User, params: SearchParams): Promise<ApiRatings | null> {
  const page = parsePage(readParam(params, "page"));
  const programIds = await readablePrograms(user, await adminScope(user));
  const staffReader = programIds === undefined || programIds.length > 0;

  if (!staffReader) {
    if (!canActAsMentor(user)) return null;
    const { range, rows, listCount, stats, spread, own } = await ownFeedback({ user, params, page });
    return {
      kind: "own",
      average: own?.average ?? null,
      count: own?.total ?? 0,
      written: own ? figures(own.general) : { count: stats._count, average: null },
      meetings: own ? figures(own.meetings) : { count: 0, average: null },
      stars: tallyStars(spread.map((r) => [r.rating, r._count._all] as const)),
      star: typeof range === "number" ? range : null,
      ratings: rows.map((f) => ({ id: f.id, rating: f.rating, comment: f.comment, sentOn: dayOf(f.createdAt), mentor: null, student: null })),
      total: listCount,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  const read = await staffFeedback({ user, programIds, params, page, listOwnMeetings: false });
  const kind = readRatingKind(params);
  const range = readRatingRange(params);
  const mentor = (m: MentorStanding & { who: { id: string; name: string | null; email: string }; low: boolean }): RatedMentor => ({
    mentor: { id: m.who.id, name: nameOf(m.who) },
    average: m.average,
    count: m.total,
    written: figures(m.general),
    meetings: figures(m.meetings),
    lastRatedOn: m.lastRated ? dayOf(m.lastRated) : null,
    lowestRecent: m.lowestRecent,
    low: m.low,
    reasons: m.low ? lowReasons(m) : [],
  });
  return {
    kind: "staff",
    average: read.ratedCount > 0 ? read.avg : null,
    count: read.ratedCount,
    basis: read.basis,
    ratingKind: kind ?? null,
    written: read.writtenAll ?? read.general,
    meetings: read.meetingsRatedAll ?? read.meetingTotal,
    stars: tallyStars([
      ...read.formSpread.map((r) => [r.rating, r._count._all] as const),
      ...read.meetingSpread.map((r) => [r.studentRating, r._count._all] as const),
    ]),
    star: typeof range === "number" ? range : null,
    attention: read.flagged.map(mentor),
    mentors: read.others.map(mentor),
    programScores:
      read.programScores.length > 1
        ? read.programScores.map((p) => ({
            program: { id: p.id, name: p.name },
            average: p.average,
            count: p.total,
            written: { count: p.writtenCount, average: p.written },
            meetings: { count: p.meetingCount, average: p.meetings },
          }))
        : [],
    filters: {
      mentors: read.rated.map((m) => ({ id: m.id, name: nameOf(m) })),
      programs: read.programs.map((p) => ({ id: p.id, name: p.name })),
      summary: read.filtered ? filterSummary(read.matched, { one: "rating", many: "ratings" }, params) : null,
    },
    ratings: read.list.map((f) => ({
      id: f.id,
      rating: f.rating,
      comment: f.comment,
      sentOn: dayOf(f.createdAt),
      mentor: { id: f.mentor.id, name: nameOf(f.mentor) },
      student: f.student ? { id: f.student.id, name: nameOf(f.student) } : null,
    })),
    total: read.stats._count,
    meetingRatings: read.meetingRows.map((s) => ({
      id: s.id,
      day: dayOf(s.date),
      rating: s.studentRating ?? 0,
      note: s.studentNote,
      mentor: { id: s.mentor.id, name: nameOf(s.mentor) },
      student: { id: s.student.user.id, name: nameOf(s.student.user) },
      program: s.program.name,
    })),
    meetingAverage: read.meetingStats._avg.studentRating,
    meetingTotal: read.meetingStats._count,
    meetingPage: parsePage(readParam(params, MEETING_PAGE)),
    page,
    pageSize: PAGE_SIZE,
  };
}
