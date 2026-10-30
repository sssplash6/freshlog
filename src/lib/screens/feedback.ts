import "server-only";

import { PAGE_SIZE, parsePage } from "@/components/ui/pagination";
import type { Column } from "@/components/ui/table";
import { adminWriteScope, staffLevel, type AdminScope } from "@/lib/authz";
import {
  activeFilterCount,
  feedbackWhere,
  filterHref,
  meetingRatingsWhere,
  readParam,
  readRatingKind,
  readRatingRange,
  type FilterPreset,
  type RatingKind,
  type SearchParams,
} from "@/lib/filters";
import { mentorStandings, overallStanding, type MentorStanding } from "@/lib/mentor-standing";
import { prisma } from "@/lib/prisma";
import { applySort, readSort } from "@/lib/sort";
import type { Prisma, User } from "@/generated/prisma/client";

/**
 * The Feedback page, read once for the website (`app/feedback/page.tsx`) and
 * the freshlog app (`/api/v1/ratings`): moved here from the page, unchanged,
 * so the two can't score a mentor differently. The page's comments came with
 * the code they explain.
 */

/** A mentor whose average sits under this is why anybody opens the page. */
export const LOW_AVERAGE = 3.5;

/** One rating this low inside the window says the same thing on its own. */
export const LOW_RATING = 2;

/** What "recent" means, in the column and in the chip. */
export const RECENT_DAYS = 30;

/** The page-number key for meeting ratings, which paginate beside the others. */
export const MEETING_PAGE = "meetings";

/**
 * The Rating select: each star on its own, which is what clicking a bar on
 * the overview sets, and the two "or fewer" windows that find a mentor who is
 * being scored badly. "5 or fewer" is every rating there is, so it is not
 * offered: a control that reads as a filter and does nothing.
 */
export const RATING_OPTIONS = [
  { value: "5", label: "5 stars" },
  { value: "4", label: "4 stars" },
  { value: "3", label: "3 stars" },
  { value: "2", label: "2 stars" },
  { value: "1", label: "1 star" },
  { value: "1-3", label: "3 stars or fewer" },
  { value: "1-2", label: "2 stars or fewer" },
];

/**
 * One-tap narrowings above the lists. `kind` and `rating` are the same params
 * the overview's figures and bars write, so a chip and a bar never disagree.
 */
export const KIND_PRESETS: readonly FilterPreset[] = [
  { label: "Written", params: { kind: "written" }, hint: "The mentor form only." },
  { label: "Meetings", params: { kind: "meetings" }, hint: "Single meetings only." },
  { label: "Low", params: { rating: "1-2" }, hint: "Two stars or fewer." },
];

/** A mentor who also holds a staff grant can narrow the page to themselves. */
export const MINE: FilterPreset = {
  label: "Mine",
  params: { mentor: "me" },
  hint: "Only ratings of you.",
};

/** What the mentors table can be ordered by. Worst combined score is the default. */
export const MENTOR_SORTS = ["mentor", "score", "ratings", "recent", "last"] as const;

/**
 * A `where` no row satisfies. One kind of rating is switched off by asking
 * for none of it, so every query keeps its place in the one `Promise.all`
 * and the page's arithmetic needs no second shape.
 */
export const NO_WRITTEN: Prisma.MentorFeedbackWhereInput = { id: { in: [] } };
export const NO_MEETINGS: Prisma.SessionWhereInput = { id: { in: [] } };

/** Everything a `PersonChip` or `PersonCell` needs, and nothing else. */
export const PERSON = {
  id: true,
  name: true,
  email: true,
  avatarUpdatedAt: true,
} as const;

/**
 * The programs whose ratings this person may read.
 *
 * `undefined` means every program, matching `FilterScope.programIds` so the
 * answer can be handed straight to `feedbackWhere`. A SALES grant is dropped:
 * owner decision 5 gives a salesperson the program and its students, and gives
 * its feedback to a LEADER. One `staffLevel` read per granted program, and
 * nobody holds more than three.
 */
export async function readablePrograms(
  user: User,
  scope: AdminScope
): Promise<readonly string[] | undefined> {
  if (scope === "ALL") return undefined;
  const ids = [...scope];
  const levels = await Promise.all(ids.map((id) => staffLevel(user, id)));
  return ids.filter((_, i) => levels[i] === "ADMIN" || levels[i] === "LEADER");
}

/**
 * A star count per score, 1 to 5, from grouped rows — two kinds pooled into
 * one array. A null score (a meeting confirmed without a rating) is dropped;
 * the grouped `where` should already have excluded it.
 */
export function tallyStars(rows: readonly (readonly [number | null, number])[]): number[] {
  const counts = [0, 0, 0, 0, 0];
  for (const [score, n] of rows) {
    if (score !== null && score >= 1 && score <= 5) counts[score - 1] += n;
  }
  return counts;
}

/** Why a mentor is in the attention group, in the words of the two rules. */
export function lowReasons(mentor: Pick<MentorStanding, "average" | "lowestRecent">): string[] {
  const reasons: string[] = [];
  if (mentor.average < LOW_AVERAGE) reasons.push(`Average under ${LOW_AVERAGE}`);
  if (mentor.lowestRecent !== null && mentor.lowestRecent <= LOW_RATING) {
    reasons.push(`Rated ${mentor.lowestRecent} in the last ${RECENT_DAYS} days`);
  }
  return reasons;
}

/** A mentor reading their own: what `OwnRatings` reads. */
export async function ownFeedback({ user, params, page }: { user: User; params: SearchParams; page: number }) {
  const where = { mentorId: user.id };
  // The bars on the overview narrow the LIST to one star; the score and the
  // bars themselves keep reading everything, or the headline would be the
  // star just clicked.
  const range = readRatingRange(params);
  const listWhere = range === undefined ? where : { ...where, rating: range };
  const [rows, listCount, stats, meetings, spread] = await Promise.all([
    prisma.mentorFeedback.findMany({
      where: listWhere,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, rating: true, comment: true, createdAt: true },
    }),
    prisma.mentorFeedback.count({ where: listWhere }),
    prisma.mentorFeedback.aggregate({
      where,
      _sum: { rating: true },
      _count: true,
    }),
    // Their meeting ratings join the average as a number only — no row, no
    // note, no date is selected, so none can reach the render.
    prisma.session.aggregate({
      where: meetingRatingsWhere({}, { mentorId: user.id }, new Date()),
      _sum: { studentRating: true },
      _count: true,
    }),
    // The written ratings' spread only: each of them is already on this page
    // with its score, so the bars say nothing the list does not. The meetings'
    // spread would — with one rated meeting, it is that meeting's score.
    prisma.mentorFeedback.groupBy({
      by: ["rating"],
      where,
      _count: { _all: true },
    }),
  ]);
  const [own] = mentorStandings(
    [
      {
        mentorId: user.id,
        sum: stats._sum.rating ?? 0,
        count: stats._count,
        last: null,
        lowestRecent: null,
      },
    ],
    [
      {
        mentorId: user.id,
        sum: meetings._sum.studentRating ?? 0,
        count: meetings._count,
        last: null,
        lowestRecent: null,
      },
    ]
  );

  return { where, range, listWhere, rows, listCount, stats, meetings, spread, own };
}

/** Every rating the reader's grants reach: what `AllRatings` reads. */
export async function staffFeedback({
  user,
  programIds,
  params,
  page,
  listOwnMeetings = true,
}: {
  user: User;
  programIds: readonly string[] | undefined;
  params: SearchParams;
  page: number;
  /**
   * List the reader's own meetings where they administer the program, with no
   * student named. The app draws every meeting rating as "student → mentor",
   * so it asks for none of them until it can draw a row without a student.
   */
  listOwnMeetings?: boolean;
}) {
  const now = new Date();
  // `userId` is what the literal `?mentor=me` resolves to, so the "Just mine"
  // chip is a real address a mentor can send someone.
  const scope = { programIds, userId: user.id };

  // `?kind=` shows one kind of rating or both. It is applied by switching the
  // other kind's queries off, so the score, the bars, the cards and the feed
  // all read the one kind — and the two figures that NAME the kinds keep their
  // full counts, since a count of zero beside the tab you did not pick would
  // say that kind had nothing to show.
  const kind = readRatingKind(params);
  const wantWritten = kind !== "meetings";
  const wantMeetings = kind !== "written";
  const whereAll = feedbackWhere(params, scope, now);
  const where = wantWritten ? whereAll : NO_WRITTEN;

  // The reader's reach with nothing from the URL in it. The mentor picker reads
  // through this rather than through `where`: built from the filtered set, it
  // would collapse to the one mentor already chosen and offer no way back.
  const inReach = feedbackWhere({}, scope, now);

  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const recentWhere = { AND: [where, { createdAt: { gte: since } }] };

  // ADMIN-level grants — the "admin" a written rating's writer is named to,
  // and the programs whose meetings the reader may read as their admin. A
  // LEADER reads every row in reach and names none of them.
  const writeScope = await adminWriteScope(user);

  // Ratings of single meetings, through the same filters. They are not
  // anonymous — the student rated one meeting so its mentor's program could act
  // on it — so the writer is named.
  //
  // The reader's OWN meetings are listed only where they ADMINISTER the
  // meeting's program, and with no student named. Until 30 October 2026 they
  // were never listed ("a mentor is not shown what students thought of
  // them"), and an admin who mentors, filtering to themselves, found 23 rated
  // meetings in their score and none in the list. Listing them was agreed that
  // day, knowing the ratings already given were given under the form's "Your
  // mentor won't see your rating", and that a one-to-one meeting's date says
  // who wrote it. A LEADER's grant only reads, so a leader who mentors still
  // gets their own as a number; the form now tells the student, per meeting,
  // whether its mentor will read it (`ratingSeenByMentor`).
  const notMine: Prisma.SessionWhereInput = { mentorId: { not: user.id } };
  const ownListed: Prisma.SessionWhereInput = !listOwnMeetings
    ? notMine
    : writeScope === "ALL"
      ? {}
      : { OR: [notMine, { programId: { in: [...writeScope] } }] };
  const meetingAll = meetingRatingsWhere(params, scope, now);
  // The combined score on each mentor card counts meeting ratings too — the
  // reader's own included, as a number, wherever the list leaves them out.
  const meetingCards = wantMeetings ? meetingAll : NO_MEETINGS;
  const meetingWhere = { AND: [meetingCards, ownListed] };
  const meetingInReach = meetingRatingsWhere({}, scope, now);
  const meetingPage = parsePage(readParam(params, MEETING_PAGE));

  const [
    stats,
    byMentor,
    lately,
    rows,
    rated,
    programs,
    meetingStats,
    meetingRows,
    meetingsByMentor,
    meetingsLately,
    formSpread,
    meetingSpread,
    meetingsByProgram,
    writtenAll,
    meetingsRatedAll,
  ] = await Promise.all([
    prisma.mentorFeedback.aggregate({
      where,
      _avg: { rating: true },
      _count: true,
    }),
    // The mentors table, in one grouped read per kind. Sums, not averages, so
    // `mentorStandings` can pool the two and order worst first.
    prisma.mentorFeedback.groupBy({
      by: ["mentorId"],
      where,
      _sum: { rating: true },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.mentorFeedback.groupBy({
      by: ["mentorId"],
      where: recentWhere,
      _min: { rating: true },
    }),
    prisma.mentorFeedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      // The writer's enrollments are fetched so the name can be opened to the
      // student's admins — the row itself names no program to check a grant
      // against. Whether the name is RENDERED is decided per row below.
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        mentor: { select: PERSON },
        student: {
          select: {
            user: { select: PERSON },
            enrollments: { select: { programId: true } },
          },
        },
      },
    }),
    // Mentors somebody in reach has actually rated — a picker offering the
    // other forty is forty ways to reach an empty list. It doubles as the name
    // lookup for the table above, since every mentor in a filtered group is
    // also a mentor in reach.
    prisma.user.findMany({
      where: {
        OR: [
          { mentorFeedback: { some: inReach } },
          { mentorSessions: { some: meetingInReach } },
        ],
      },
      orderBy: { name: "asc" },
      select: PERSON,
    }),
    prisma.program.findMany({
      where: programIds ? { id: { in: [...programIds] } } : {},
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.session.aggregate({
      where: meetingWhere,
      _avg: { studentRating: true },
      _count: true,
    }),
    prisma.session.findMany({
      where: meetingWhere,
      orderBy: [{ studentAnsweredAt: "desc" }, { date: "desc" }],
      skip: (meetingPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        date: true,
        studentRating: true,
        studentNote: true,
        mentor: { select: PERSON },
        student: { select: { user: { select: PERSON } } },
        program: { select: { name: true } },
      },
    }),
    prisma.session.groupBy({
      by: ["mentorId"],
      where: meetingCards,
      _sum: { studentRating: true },
      _count: { _all: true },
      _max: { studentAnsweredAt: true },
    }),
    prisma.session.groupBy({
      by: ["mentorId"],
      where: { AND: [meetingCards, { studentAnsweredAt: { gte: since } }] },
      _min: { studentRating: true },
    }),
    // The 1-to-5 spread behind the headline, through the same two `where`s
    // the cards pool — so the bars add up to the headline's count.
    prisma.mentorFeedback.groupBy({
      by: ["rating"],
      where,
      _count: { _all: true },
    }),
    prisma.session.groupBy({
      by: ["studentRating"],
      where: meetingCards,
      _count: { _all: true },
    }),
    prisma.session.groupBy({
      by: ["programId"],
      where: meetingCards,
      _sum: { studentRating: true },
      _count: { _all: true },
    }),
    // The two figures' full counts, only when a kind is switched off and the
    // grouped reads above no longer hold them.
    wantWritten ? null : prisma.mentorFeedback.count({ where: whereAll }),
    wantMeetings ? null : prisma.session.count({ where: meetingAll }),
  ]);

  // A written rating names no program, so it counts in each program its writer
  // is enrolled in — the same answer the Program filter gives, so a program's
  // line matches the page filtered to that program. One read per program the
  // reader can see, and that is a handful.
  const writtenByProgram = await Promise.all(
    programs.map((p) =>
      prisma.mentorFeedback.aggregate({
        where: {
          AND: [where, { student: { enrollments: { some: { programId: p.id } } } }],
        },
        _sum: { rating: true },
        _count: true,
      })
    )
  );
  const meetingProgram = new Map(meetingsByProgram.map((r) => [r.programId, r]));
  const programScores = programs
    .flatMap((p, i) => {
      const written = writtenByProgram[i];
      const meetings = meetingProgram.get(p.id);
      const gCount = written._count;
      const mCount = meetings?._count._all ?? 0;
      const total = gCount + mCount;
      if (total === 0) return [];
      const gSum = written._sum.rating ?? 0;
      const mSum = meetings?._sum.studentRating ?? 0;
      return [
        {
          ...p,
          average: (gSum + mSum) / total,
          total,
          written: gCount ? gSum / gCount : null,
          writtenCount: gCount,
          meetings: mCount ? mSum / mCount : null,
          meetingCount: mCount,
        },
      ];
    })
    // Worst first, like everything else on this page.
    .sort((a, b) => a.average - b.average || b.total - a.total);

  const person = new Map(rated.map((m) => [m.id, m]));
  const generalRecent = new Map(lately.map((r) => [r.mentorId, r._min.rating]));
  const meetingRecent = new Map(
    meetingsLately.map((r) => [r.mentorId, r._min.studentRating])
  );
  const standings = mentorStandings(
    byMentor.map((row) => ({
      mentorId: row.mentorId,
      sum: row._sum.rating ?? 0,
      count: row._count._all,
      last: row._max.createdAt,
      lowestRecent: generalRecent.get(row.mentorId) ?? null,
    })),
    meetingsByMentor.map((row) => ({
      mentorId: row.mentorId,
      sum: row._sum.studentRating ?? 0,
      count: row._count._all,
      last: row._max.studentAnsweredAt,
      lowestRecent: meetingRecent.get(row.mentorId) ?? null,
    }))
  );
  const mentors = standings.flatMap((s) => {
    const who = person.get(s.mentorId);
    if (!who) return [];
    const recent = s.lowestRecent;
    return [
      {
        ...s,
        who,
        low: s.average < LOW_AVERAGE || (recent !== null && recent <= LOW_RATING),
      },
    ];
  });

  /**
   * The name is open to the writer's admins and to nobody else — including
   * the mentor the rating is about, whatever else they administer. Decided
   * per row by the reader's ADMIN grants against the writer's own programs:
   * a rating is readable through any one of a student's programs, but its
   * author is named only where the reader actually administers one — the
   * same intersection `studentScope` answers for everything else about the
   * student.
   */
  const namesFor =
    writeScope === "ALL"
      ? () => true
      : (enrollments: readonly { programId: string }[]) =>
          enrollments.some((e) => writeScope.has(e.programId));
  const list = rows.map((f) => ({
    id: f.id,
    rating: f.rating,
    comment: f.comment,
    createdAt: f.createdAt,
    mentor: f.mentor,
    student:
      f.mentor.id !== user.id && namesFor(f.student.enrollments)
        ? f.student.user
        : null,
  }));
  // The reader's own meetings name nobody: they are listed to the reader as
  // the program's admin, not as the mentor the rating is about.
  const meetingList = meetingRows.map((s) => ({
    id: s.id,
    date: s.date,
    studentRating: s.studentRating,
    studentNote: s.studentNote,
    mentor: s.mentor,
    student: s.mentor.id === user.id ? null : s.student.user,
    program: s.program,
  }));

  // The headline is the cards' own arithmetic, so it agrees with them: every
  // rating of either kind, pooled.
  const { average: avg, total: ratedCount } = overallStanding(standings);
  const lowCount = mentors.filter((m) => m.low).length;
  const filtered = activeFilterCount(params) > 0;

  // Every heading orders the table. A first click on a figure opens at the
  // top of it — best score, most ratings, latest — and the lowest recent
  // rating opens lowest first, since that is what it is there to find.
  const columns: Column[] = [
    { label: "Mentor", sort: "mentor" },
    { label: "Combined", align: "right", emphasis: "key", sort: "score", sortDir: "desc" },
    { label: "Ratings", align: "right", sort: "ratings", sortDir: "desc" },
    { label: "Lowest recent", align: "right", sort: "recent" },
    { label: "Last rated", align: "right", sort: "last", sortDir: "desc" },
  ];
  const asked = readSort(
    {
      ...(readParam(params, "sort") ? { sort: readParam(params, "sort") } : {}),
      ...(readParam(params, "dir") ? { dir: readParam(params, "dir") } : {}),
    },
    MENTOR_SORTS
  );

  // Worst first unless a heading says otherwise, in two groups: the mentors
  // somebody should look at, as cards that say why, and everyone else in one
  // table — all of them, since a sorted table with its tail folded away would
  // hide the very rows the sort put on top.
  const flagged = mentors.filter((m) => m.low);
  const others = applySort(
    mentors.filter((m) => !m.low),
    asked,
    {
      mentor: (m) => m.who.name ?? m.who.email,
      score: (m) => m.average,
      ratings: (m) => m.total,
      recent: (m) => m.lowestRecent,
      last: (m) => m.lastRated,
    }
  );

  const general = byMentor.reduce((n, r) => n + r._count._all, 0);
  const meetingTotal = meetingsByMentor.reduce((n, r) => n + r._count._all, 0);
  // The reader's own meetings the list leaves out: a leader's, or all of them
  // for the app. The cards' `where` and the list's differ only by `ownListed`,
  // so the gap between their counts is exactly those — and the page can say
  // why a list the reader's own card counts is empty.
  const ownWithheld = meetingTotal - meetingStats._count;
  // Every rating the filters match, both kinds — the overview's own count —
  // for the sentence beside Reset. It counted the written list alone, and said
  // "No ratings match these filters" above a list of meeting ratings.
  const matched = stats._count + meetingTotal;
  const range = readRatingRange(params);
  const clearRating = filterHref("/feedback", params, { rating: undefined });
  const bothKinds = filterHref("/feedback", params, { kind: undefined });
  const kindHref = (k: RatingKind, anchor: string) =>
    `${filterHref("/feedback", params, { kind: kind === k ? undefined : k })}#${anchor}`;
  const basis =
    kind === "written"
      ? "written ratings"
      : kind === "meetings"
        ? "meeting ratings"
        : "both kinds pooled";

  return {
    now,
    scope,
    kind,
    wantWritten,
    wantMeetings,
    whereAll,
    where,
    inReach,
    since,
    recentWhere,
    notMine,
    meetingAll,
    meetingCards,
    meetingWhere,
    meetingInReach,
    meetingPage,
    writtenByProgram,
    meetingProgram,
    programScores,
    person,
    generalRecent,
    meetingRecent,
    standings,
    mentors,
    namesFor,
    list,
    meetingList,
    matched,
    lowCount,
    filtered,
    columns,
    asked,
    flagged,
    others,
    general,
    meetingTotal,
    ownWithheld,
    range,
    clearRating,
    bothKinds,
    kindHref,
    basis,
    stats,
    byMentor,
    lately,
    rows,
    rated,
    programs,
    writeScope,
    meetingStats,
    meetingRows,
    meetingsByMentor,
    meetingsLately,
    formSpread,
    meetingSpread,
    meetingsByProgram,
    writtenAll,
    meetingsRatedAll,
    avg,
    ratedCount,
  };
}
