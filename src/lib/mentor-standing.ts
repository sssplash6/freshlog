/**
 * One mentor's combined score: every rating a student gave them, of either
 * kind, counted once.
 *
 * A student rates a mentor in two places — the anonymous mentor form
 * (`MentorFeedback`) and a single meeting (`Session.studentRating`) — and both
 * are 1 to 5. The combined score POOLS them: the sum of every rating over the
 * count of every rating. It does not average the two averages, because a mentor
 * with one form and twenty rated meetings would then owe half their score to
 * one student.
 *
 * Pure, so the arithmetic is tested without a database; the page groups the
 * rows and hands the tallies in.
 */

/** One kind of rating for one mentor, as a grouped query returns it. */
export type RatingTally = {
  mentorId: string;
  sum: number;
  count: number;
  last: Date | null;
  /** The lowest rating inside the recent window, if any fell inside it. */
  lowestRecent: number | null;
};

export type MentorStanding = {
  mentorId: string;
  /** The pooled average of every rating, 1 to 5. */
  average: number;
  total: number;
  general: { count: number; average: number | null };
  meetings: { count: number; average: number | null };
  lastRated: Date | null;
  lowestRecent: number | null;
};

function later(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function lower(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * Every mentor with a rating of either kind, worst combined average first — a
 * tie goes to the mentor more students have rated, which is the order the
 * Feedback page was built around.
 */
export function mentorStandings(
  general: readonly RatingTally[],
  meetings: readonly RatingTally[]
): MentorStanding[] {
  const byGeneral = new Map(general.map((t) => [t.mentorId, t]));
  const byMeeting = new Map(meetings.map((t) => [t.mentorId, t]));
  const ids = new Set([...byGeneral.keys(), ...byMeeting.keys()]);

  const standings: MentorStanding[] = [];
  for (const mentorId of ids) {
    const g = byGeneral.get(mentorId);
    const m = byMeeting.get(mentorId);
    const gCount = g?.count ?? 0;
    const mCount = m?.count ?? 0;
    const total = gCount + mCount;
    if (total === 0) continue;
    standings.push({
      mentorId,
      average: ((g?.sum ?? 0) + (m?.sum ?? 0)) / total,
      total,
      general: { count: gCount, average: gCount ? g!.sum / gCount : null },
      meetings: { count: mCount, average: mCount ? m!.sum / mCount : null },
      lastRated: later(g?.last ?? null, m?.last ?? null),
      lowestRecent: lower(g?.lowestRecent ?? null, m?.lowestRecent ?? null),
    });
  }

  return standings.sort(
    (a, b) =>
      a.average - b.average ||
      b.total - a.total ||
      a.mentorId.localeCompare(b.mentorId)
  );
}

/** The whole set's pooled average and count — the page's own headline. */
export function overallStanding(standings: readonly MentorStanding[]): {
  average: number | null;
  total: number;
} {
  const total = standings.reduce((n, s) => n + s.total, 0);
  if (total === 0) return { average: null, total: 0 };
  const sum = standings.reduce((n, s) => n + s.average * s.total, 0);
  return { average: sum / total, total };
}
