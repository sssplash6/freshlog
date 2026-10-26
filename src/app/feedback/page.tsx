import Link from "next/link";
import { redirect } from "next/navigation";

import { ExpandableText } from "@/components/expandable-text";
import { PersonCell, PersonChip } from "@/components/person-chip";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { PAGE_SIZE, Pagination, parsePage } from "@/components/ui/pagination";
import { Eyebrow, PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { FILL_CELL, Table, Td, Tr, type Column } from "@/components/ui/table";
import {
  adminScope,
  adminWriteScope,
  staffLevel,
  type AdminScope,
} from "@/lib/authz";
import { canActAsMentor, inStudentLens } from "@/lib/constants";
import { requireUser } from "@/lib/dal";
import {
  activeFilterCount,
  feedbackWhere,
  filterSummary,
  meetingRatingsWhere,
  readDateWindow,
  readParam,
  type SearchParams,
} from "@/lib/filters";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import {
  mentorStandings,
  overallStanding,
  type MentorStanding,
} from "@/lib/mentor-standing";
import { homeFor, profileOf } from "@/lib/profile";
import type { User } from "@/generated/prisma/client";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Feedback" };

/**
 * Every rating in the product, at one address, in the shape the reader needs.
 *
 * It replaces `/admin/feedback` and `/mentor/feedback`, which were the same
 * table read twice: one grouped every rating by mentor and named the students
 * who left them, the other listed one mentor's own and named nobody. Two pages,
 * two paginations, two empty states and two definitions of an average.
 *
 * THE PAGE IS ORDERED BY THE WORST AVERAGE, and that is the whole design. It
 * used to be ordered by rating COUNT (`feedback.ts:26`), which put the busiest
 * mentor on top and buried the one with two ratings of 1 — the only mentor
 * anybody has ever opened this page to find.
 *
 * THREE THINGS THE OLD PAGES LET A READER SEE THAT THEY SHOULD NOT, all closed
 * here:
 *
 *   1. A rating carried the name of the student who left it, readable by
 *      anyone with a grant. The form promises the student their name is not
 *      shown to the mentor, so it is shown to the student's own admins —
 *      the people who moderate what was said — and to nobody else: not the
 *      mentor, not a leader, not an admin of a program the writer is not
 *      in. Decided per row from the WRITER's enrollments, because the row
 *      itself names no program.
 *   2. The mentor picker read `mentorFeedback: { some: {} }` — every mentor
 *      rated anywhere, by name and email, offered to a leader granted one
 *      program. It reads through the reader's own scope now.
 *   3. Website ratings were fetched with no scope at all and rendered with the
 *      student's name and email beside each comment. That table is gone (M5).
 *
 * And SALES no longer reaches this page. `requireAdminAccess` admits any
 * non-empty scope, so a salesperson who typed /admin/feedback was let in and
 * read their program's comments; the nav merely did not link it. Owner
 * decision 5 gives feedback to LEADER and ADMIN grants, and `readablePrograms`
 * below is that sentence.
 */

/** A mentor whose average sits under this is why anybody opens the page. */
const LOW_AVERAGE = 3.5;

/** One rating this low inside the window says the same thing on its own. */
const LOW_RATING = 2;

/** What "recent" means, in the column and in the chip. */
const RECENT_DAYS = 30;

/** The page-number key for meeting ratings, which paginate beside the others. */
const MEETING_PAGE = "meetings";

/** Mentors open before the tail folds away — the tail is the settled subset. */
const WORST_SHOWN = 8;

/**
 * "Rating at most N" — how a mentor who is being scored badly is found.
 *
 * Only 1 to 4: "5 or fewer" is every rating there is, so it would be a control
 * that reads as a filter and does nothing.
 */
const RATING_OPTIONS = [
  { value: "1", label: "1 star" },
  { value: "2", label: "2 stars or fewer" },
  { value: "3", label: "3 stars or fewer" },
  { value: "4", label: "4 stars or fewer" },
];

/** Everything a `PersonChip` or `PersonCell` needs, and nothing else. */
const PERSON = {
  id: true,
  name: true,
  email: true,
  avatarUpdatedAt: true,
} as const;

/** "1 rating" / "12 ratings", so no call site concatenates its own plural. */
function count(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

/**
 * The programs whose ratings this person may read.
 *
 * `undefined` means every program, matching `FilterScope.programIds` so the
 * answer can be handed straight to `feedbackWhere`. A SALES grant is dropped:
 * owner decision 5 gives a salesperson the program and its students, and gives
 * its feedback to a LEADER. One `staffLevel` read per granted program, and
 * nobody holds more than three.
 */
async function readablePrograms(
  user: User,
  scope: AdminScope
): Promise<readonly string[] | undefined> {
  if (scope === "ALL") return undefined;
  const ids = [...scope];
  const levels = await Promise.all(ids.map((id) => staffLevel(user, id)));
  return ids.filter((_, i) => levels[i] === "ADMIN" || levels[i] === "LEADER");
}

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();

  // A student's ratings live where they leave them. `/student/feedback` is the
  // form AND the history (§2.1 row 27), so a second copy of that history here
  // would be the "two pages for one person" defect this reorganisation exists
  // to remove.
  if (inStudentLens(user, await profileOf(user))) redirect("/student/feedback");

  // Gate first, query second — and the gate is the reader's grants, never the
  // lens. Someone who can read a program's ratings gets the staff shape in
  // either lens; the lens only chooses what leads (§3).
  const scope = await adminScope(user);
  const programIds = await readablePrograms(user, scope);
  const staffReader = programIds === undefined || programIds.length > 0;
  const mentorReader = canActAsMentor(user);
  if (!staffReader && !mentorReader) {
    redirect(homeFor(user, await profileOf(user)));
  }

  const params = await searchParams;
  const page = parsePage(readParam(params, "page"));

  if (!staffReader) return <OwnRatings user={user} params={params} page={page} />;
  return (
    <AllRatings
      user={user}
      programIds={programIds}
      params={params}
      page={page}
    />
  );
}

/* ------------------------------------------------- the mentor's own shape --- */

/** The promise the rating form made the student, repeated where it is kept. */
const ANONYMOUS =
  "Anonymous — you never see which student wrote a rating.";

/**
 * A mentor reading their own: an average, a count, and the comments.
 *
 * No filter bar and no mentors table, because both would be one row and one
 * name — their own. The student is not selected AT THE QUERY rather than
 * dropped at the render, so the anonymity the form promised cannot be undone by
 * someone later adding a column to a row component.
 */
async function OwnRatings({
  user,
  params,
  page,
}: {
  user: User;
  params: SearchParams;
  page: number;
}) {
  const where = { mentorId: user.id };
  const [rows, stats, meetings, spread] = await Promise.all([
    prisma.mentorFeedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, rating: true, comment: true, createdAt: true },
    }),
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

  return (
    <div className="space-y-4">
      <PageTitle title="Feedback" />

      {own && (
        <Overview
          average={own.average}
          total={own.total}
          spread={{
            title: "Written ratings",
            counts: tallyStars(
              spread.map((r) => [r.rating, r._count._all] as const)
            ),
          }}
          figures={[
            {
              label: "Written ratings",
              value: String(own.general.count),
              hint:
                own.general.average === null
                  ? undefined
                  : `${own.general.average.toFixed(1)} average`,
            },
            {
              label: "Meetings rated",
              value: String(own.meetings.count),
              hint:
                own.meetings.average === null
                  ? undefined
                  : `${own.meetings.average.toFixed(1)} average`,
            },
          ]}
        />
      )}

      {!own ? (
        <EmptyState title="No ratings yet">
          Students rate a mentor when they choose to; many never do.
        </EmptyState>
      ) : stats._count === 0 ? (
        <EmptyState title="No written ratings yet">
          Your combined score comes from the meetings students rated. You see
          the score, not the ratings.
        </EmptyState>
      ) : (
        <>
          {/* Said on the page, not only in a tooltip: the promise the rating
              form made the student is the thing a mentor most needs to trust
              here, and a `title` is invisible on a phone. */}
          <Section title="Ratings" count={stats._count} caption={ANONYMOUS}>
            <ul className="divide-y divide-line">
              {rows.map((f) => (
                <FeedItem
                  key={f.id}
                  score={f.rating}
                  text={f.comment}
                  aside={formatDate(f.createdAt)}
                />
              ))}
            </ul>
          </Section>
          <Pagination
            basePath="/feedback"
            params={params}
            page={page}
            total={stats._count}
            unit="ratings"
            className="px-1"
          />
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------- the staff shape --- */

/**
 * Every rating the reader's grants reach: who is slipping, then what was said.
 *
 * SIX QUERIES, whatever the data holds. The page this replaces ran two per
 * mentor on top of its aggregates — a `findUnique` for the name and a
 * `findMany` for that mentor's latest six comments (`feedback.ts:33-45`) — so a
 * page of ten mentors was twenty-two round trips and a busier school was more.
 * The comments are one chronological list now, which is both the cheaper query
 * and the truer reading: "what has been said lately" is a question about the
 * school, not about each mentor in turn.
 *
 * The table and the list read through the SAME `where`. A filtered list beside
 * an unfiltered average is two answers to one question.
 */
async function AllRatings({
  user,
  programIds,
  params,
  page,
}: {
  user: User;
  programIds: readonly string[] | undefined;
  params: SearchParams;
  page: number;
}) {
  const now = new Date();
  // `userId` is what the literal `?mentor=me` resolves to, so the "Just mine"
  // chip is a real address a mentor can send someone.
  const scope = { programIds, userId: user.id };
  const where = feedbackWhere(params, scope, now);

  // The reader's reach with nothing from the URL in it. The mentor picker reads
  // through this rather than through `where`: built from the filtered set, it
  // would collapse to the one mentor already chosen and offer no way back.
  const inReach = feedbackWhere({}, scope, now);

  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const recentWhere = { AND: [where, { createdAt: { gte: since } }] };

  // Ratings of single meetings, through the same filters. They are not
  // anonymous — the student rated one meeting so its mentor's program could act
  // on it — so the writer is named. Never the reader's own meetings, though:
  // a mentor is not shown what students thought of them (`/mentors/[id]`
  // drops it for `isSelf`, `/sessions` for the mentor audience), and holding
  // an admin grant does not change that here.
  const notMine = { mentorId: { not: user.id } };
  const meetingWhere = {
    AND: [meetingRatingsWhere(params, scope, now), notMine],
  };
  // The combined score on each mentor card counts meeting ratings too — the
  // reader's own included, as a number. Only the LIST above hides the reader's
  // own meetings; their card's score is the one figure they asked to see.
  const meetingCards = meetingRatingsWhere(params, scope, now);
  const meetingInReach = meetingRatingsWhere({}, scope, now);
  const meetingPage = parsePage(readParam(params, MEETING_PAGE));

  const [
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
    // ADMIN-level grants — the "admin" the name is open to. A LEADER reads
    // every row in reach and names none of them.
    adminWriteScope(user),
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
    student: namesFor(f.student.enrollments) ? f.student.user : null,
  }));

  // The headline is the cards' own arithmetic, so it agrees with them: every
  // rating of either kind, pooled.
  const { average: avg, total: ratedCount } = overallStanding(standings);
  const lowCount = mentors.filter((m) => m.low).length;
  const filtered = activeFilterCount(params) > 0;

  const columns: Column[] = [
    { label: "Mentor" },
    { label: "Combined", align: "right", emphasis: "key" },
    { label: "Ratings", align: "right" },
    { label: "Lowest recent", align: "right" },
    { label: "Last rated", align: "right" },
  ];

  // Still worst first, in two groups: the mentors somebody should look at,
  // as cards that say why, and everyone else in the table.
  const flagged = mentors.filter((m) => m.low);
  const others = mentors.filter((m) => !m.low);
  const worst = others.slice(0, WORST_SHOWN);
  const rest = others.slice(WORST_SHOWN);

  const general = byMentor.reduce((n, r) => n + r._count._all, 0);
  const meetingTotal = meetingsByMentor.reduce((n, r) => n + r._count._all, 0);

  return (
    <div className="space-y-4">
      <PageTitle title="Feedback" />

      {avg !== null && (
        <Overview
          average={avg}
          total={ratedCount}
          spread={{
            title: "Every rating",
            counts: tallyStars([
              ...formSpread.map((r) => [r.rating, r._count._all] as const),
              ...meetingSpread.map(
                (r) => [r.studentRating, r._count._all] as const
              ),
            ]),
          }}
          figures={[
            {
              label: "Need attention",
              value: String(lowCount),
              hint: `of ${count(mentors.length, "mentor")}`,
              tone: lowCount > 0 ? "attention" : "ink",
            },
            {
              label: "Written ratings",
              value: String(general),
            },
            {
              label: "Meetings rated",
              value: String(meetingTotal),
            },
          ]}
        />
      )}

      {/* One line each, not a card each: a program is a row of the school's
          score, and a reader with one program has nothing to compare it to. */}
      {programScores.length > 1 && (
        <Section
          title="Programs"
          count={programScores.length}
          caption="A written rating counts in every program its writer studies in."
        >
          <ul className="divide-y divide-line/70">
            {programScores.map((p) => (
              <ProgramLine key={p.id} program={p} params={params} />
            ))}
          </ul>
        </Section>
      )}

      <FilterBar
        basePath="/feedback"
        params={params}
        q="feedback"
        selects={[
          {
            name: "mentor",
            label: "Mentor",
            all: "All mentors",
            options: rated.map((m) => ({
              value: m.id,
              label: m.name ?? m.email,
              hint: m.name ? m.email : undefined,
            })),
          },
          {
            name: "program",
            label: "Program",
            all: "All programs",
            options: programs.map((p) => ({ value: p.id, label: p.name })),
          },
          {
            name: "rating",
            label: "Rating",
            all: "Any rating",
            options: RATING_OPTIONS,
          },
        ]}
        dateRange={readDateWindow(params, now)}
        // Only once a filter is on. Unfiltered, the sentence would repeat the
        // overview a few pixels above it; filtered, it says the one thing the
        // overview cannot — that the number is a subset, and here is the way
        // back out.
        summary={
          filtered
            ? filterSummary(
                stats._count,
                { one: "rating", many: "ratings" },
                params
              )
            : undefined
        }
      />

      {flagged.length > 0 && (
        <Section
          title="Needs attention"
          count={flagged.length}
          caption={`Under ${LOW_AVERAGE}, or a ${LOW_RATING} or lower in ${RECENT_DAYS} days.`}
          bare
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {flagged.map((m) => (
            <AttentionCard key={m.who.id} mentor={m} />
          ))}
        </Section>
      )}

      {others.length > 0 && (
        <Section
          title={flagged.length > 0 ? "Other mentors" : "Mentors"}
          count={others.length}
          caption={`Recent is the last ${RECENT_DAYS} days.`}
        >
          <Table columns={columns} framed={false}>
            {worst.map((m) => (
              <MentorRow key={m.who.id} mentor={m} />
            ))}
          </Table>
          <Disclosure
            label="Mentors rated higher"
            count={rest.length}
            className="border-t border-line px-4 sm:px-5"
          >
            <Table
              columns={columns}
              framed={false}
              className="-mx-4 border-t border-line sm:-mx-5"
            >
              {rest.map((m) => (
                <MentorRow key={m.who.id} mentor={m} />
              ))}
            </Table>
          </Disclosure>
        </Section>
      )}

      {/* What was said, the two kinds side by side from `lg` up: the words
          are read together, and stacked the meeting ratings sat a whole
          page of comments below the mentors they explain. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Section
            eyebrow="Anonymous to the mentor"
            title="Written ratings"
            count={stats._count}
          >
            {list.length === 0 ? (
              filtered ? (
                <EmptyState framed={false} variant="no-results">
                  Widen the window, or reset to read every rating.
                </EmptyState>
              ) : (
                <EmptyState framed={false} title="No ratings">
                  A student rates a mentor from their own feedback page.
                </EmptyState>
              )
            ) : (
              <ul className="divide-y divide-line/70">
                {list.map((f) => (
                  <FeedItem
                    key={f.id}
                    score={f.rating}
                    mentor={f.mentor}
                    aside={formatDate(f.createdAt)}
                    text={f.comment}
                    // Who said it is open to the writer's admins only.
                    meta={
                      f.student ? (f.student.name ?? f.student.email) : "Anonymous"
                    }
                  />
                ))}
              </ul>
            )}
          </Section>
          <Pagination
            basePath="/feedback"
            params={params}
            page={page}
            total={stats._count}
            unit="ratings"
            className="px-1"
          />
        </div>

        <div className="min-w-0 space-y-2">
          <Section
            eyebrow={
              meetingStats._avg.studentRating === null
                ? "One meeting each"
                : `${meetingStats._avg.studentRating.toFixed(1)} average · one meeting each`
            }
            title="Meeting ratings"
            count={meetingStats._count}
          >
            {meetingRows.length === 0 ? (
              filtered ? (
                <EmptyState framed={false} variant="no-results">
                  No meeting ratings match these filters.
                </EmptyState>
              ) : (
                <EmptyState framed={false} title="No meeting ratings">
                  A student rates a meeting when they confirm it happened.
                </EmptyState>
              )
            ) : (
              <ul className="divide-y divide-line/70">
                {meetingRows.map((s) => (
                  <FeedItem
                    key={s.id}
                    score={s.studentRating}
                    mentor={s.mentor}
                    aside={formatDate(s.date)}
                    text={s.studentNote}
                    meta={`${s.student.user.name ?? s.student.user.email} · ${s.program.name}`}
                  />
                ))}
              </ul>
            )}
          </Section>
          <Pagination
            basePath="/feedback"
            params={params}
            page={meetingPage}
            total={meetingStats._count}
            unit="meeting ratings"
            param={MEETING_PAGE}
            className="px-1"
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ parts --- */

type MentorCard = MentorStanding & {
  who: { id: string; name: string | null; email: string; avatarUpdatedAt: Date | null };
  low: boolean;
};

/** "Form 4.5 · Meetings 4.3" — what the combined score is made of. */
function parts(mentor: MentorStanding): string {
  return [
    mentor.general.average !== null && `Form ${mentor.general.average.toFixed(1)}`,
    mentor.meetings.average !== null &&
      `Meetings ${mentor.meetings.average.toFixed(1)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "2 form · 4 meetings" — how many of each went into it. */
function partCounts(mentor: MentorStanding): string {
  return [
    mentor.general.count > 0 && `${mentor.general.count} form`,
    mentor.meetings.count > 0 && count(mentor.meetings.count, "meeting"),
  ]
    .filter(Boolean)
    .join(" · ");
}

function MentorRow({ mentor }: { mentor: MentorCard }) {
  return (
    <Tr>
      <Td label="Mentor" className={FILL_CELL}>
        <PersonCell person={mentor.who} href={`/mentors/${mentor.who.id}`}>
          {mentor.low && <StatusChip severity="attention">Low</StatusChip>}
        </PersonCell>
      </Td>
      <Td label="Combined" align="right" tone="key">
        <span className="tabular-nums text-ink">
          {mentor.average.toFixed(1)}
        </span>
        <AverageStars value={mentor.average} />
        <span className="block text-xs tabular-nums text-muted-fg">
          {parts(mentor)}
        </span>
      </Td>
      <Td label="Ratings" align="right" tone="muted" className="tabular-nums">
        {partCounts(mentor)}
      </Td>
      <Td label="Lowest recent" align="right">
        {mentor.lowestRecent === null ? (
          <span className="text-muted-fg">—</span>
        ) : (
          <span className="tabular-nums text-ink">{mentor.lowestRecent}</span>
        )}
      </Td>
      <Td label="Last rated" align="right" tone="muted">
        {mentor.lastRated ? formatDate(mentor.lastRated) : "—"}
      </Td>
    </Tr>
  );
}

/**
 * The average's shape, beside the average's value.
 *
 * Ink, not the accent orange `Rating` uses: orange means HOURS everywhere in
 * this product, and a column of it running down a mentors table reads as a
 * quantity of time rather than as a score. `aria-hidden` because the number
 * immediately before it is the same fact — a screen reader that read both would
 * say "four point three, four out of five stars".
 */
function AverageStars({ value }: { value: number }) {
  const filled = Math.round(value);
  return (
    <span
      aria-hidden="true"
      className="ml-1.5 align-middle text-caption tracking-tight text-ink"
    >
      {"★".repeat(filled)}
      <span className="text-muted-fg">{"☆".repeat(5 - filled)}</span>
    </span>
  );
}

/**
 * A star count per score, 1 to 5, from grouped rows — two kinds pooled into
 * one array. A null score (a meeting confirmed without a rating) is dropped;
 * the grouped `where` should already have excluded it.
 */
function tallyStars(rows: readonly (readonly [number | null, number])[]): number[] {
  const counts = [0, 0, 0, 0, 0];
  for (const [score, n] of rows) {
    if (score !== null && score >= 1 && score <= 5) counts[score - 1] += n;
  }
  return counts;
}

/**
 * The page's one lead, and what stands behind it: the combined score, how the
 * ratings spread across 1 to 5, and two or three quieter counts.
 *
 * One card in three bands divided by hairlines, the `StatStrip` shape, with
 * the spread where its second figure would be. The bars are ink, not orange:
 * orange means hours, and a column of it here would read as time.
 */
function Overview({
  average,
  total,
  spread,
  figures,
}: {
  average: number;
  total: number;
  spread: { title: string; counts: number[] };
  figures: {
    label: string;
    value: string;
    hint?: string;
    tone?: "ink" | "attention";
  }[];
}) {
  const most = Math.max(1, ...spread.counts);
  const filled = Math.round(average);
  return (
    <div className="@container">
      <div className="grid divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-sm @3xl:grid-cols-[1fr_1.6fr_1fr] @3xl:divide-x @3xl:divide-y-0">
        <div className="min-w-0 px-4 py-4 @3xl:px-5 @3xl:py-5">
          <Eyebrow>Combined score</Eyebrow>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-lead font-semibold tabular-nums text-ink">
              {average.toFixed(1)}
            </span>
            <span className="text-sm text-muted-fg">of 5</span>
          </div>
          <div aria-hidden="true" className="mt-1 text-title tracking-tight text-ink">
            {"★".repeat(filled)}
            <span className="text-line-strong">{"★".repeat(5 - filled)}</span>
          </div>
          <p className="mt-2 text-xs text-muted-fg">
            From {count(total, "rating")}, both kinds pooled.
          </p>
        </div>

        <div className="min-w-0 px-4 py-4 @3xl:px-5 @3xl:py-5">
          <Eyebrow>{spread.title}</Eyebrow>
          <ul className="mt-2.5 space-y-1.5">
            {[5, 4, 3, 2, 1].map((star) => {
              const n = spread.counts[star - 1];
              return (
                <li
                  key={star}
                  className="grid grid-cols-[2.25rem_1fr_2.5rem] items-center gap-3 text-xs"
                >
                  <span className="tabular-nums text-muted-fg">{star} ★</span>
                  <span
                    className="h-2 overflow-hidden rounded-full bg-fill"
                    role="img"
                    aria-label={`${count(n, "rating")} of ${star}`}
                  >
                    <span
                      className={cn(
                        "bar-grow block h-full rounded-full",
                        star <= LOW_RATING ? "bg-warn-ink" : "bg-ink/70"
                      )}
                      style={{ width: `${(n / most) * 100}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums text-ink">{n}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <dl className="grid min-w-0 content-center divide-y divide-line">
          {figures.map((f) => (
            <div
              key={f.label}
              className="flex items-baseline justify-between gap-3 px-4 py-3 @3xl:px-5"
            >
              <dt className="text-xs font-medium text-muted-fg">{f.label}</dt>
              <dd className="text-right">
                <span
                  className={cn(
                    "text-figure-md font-semibold tabular-nums",
                    f.tone === "attention" ? "text-warn-ink" : "text-ink"
                  )}
                >
                  {f.value}
                </span>
                {f.hint && (
                  <span className="ml-1.5 text-xs text-muted-fg">{f.hint}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/**
 * One program's combined score on one line: the name, what the score is made
 * of, and the score with its stars. The line narrows the page to that program,
 * the filter its figures already agree with.
 */
function ProgramLine({
  program,
  params,
}: {
  program: {
    id: string;
    name: string;
    average: number;
    total: number;
    written: number | null;
    writtenCount: number;
    meetings: number | null;
    meetingCount: number;
  };
  params: SearchParams;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "page" || key === MEETING_PAGE || key === "program") continue;
    for (const v of [value].flat()) if (v) query.append(key, v);
  }
  query.set("program", program.id);
  const low = program.average < LOW_AVERAGE;
  return (
    <li>
      <Link
        href={`/feedback?${query}`}
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-fill/60 sm:px-5"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{program.name}</span>
          {low && <StatusChip severity="attention">Low</StatusChip>}
        </span>
        <span className="flex items-baseline gap-4">
          <span className="text-xs tabular-nums text-muted-fg">
            {[
              program.written !== null &&
                `Written ${program.written.toFixed(1)} · ${program.writtenCount}`,
              program.meetings !== null &&
                `Meetings ${program.meetings.toFixed(1)} · ${program.meetingCount}`,
            ]
              .filter(Boolean)
              .join("  ·  ")}
          </span>
          <span className="whitespace-nowrap">
            <span className="text-sm font-semibold tabular-nums text-ink">
              {program.average.toFixed(1)}
            </span>
            <AverageStars value={program.average} />
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Why a mentor is in the attention group, in the words of the two rules. */
function lowReasons(mentor: MentorCard): string[] {
  const reasons: string[] = [];
  if (mentor.average < LOW_AVERAGE) reasons.push(`Average under ${LOW_AVERAGE}`);
  if (mentor.lowestRecent !== null && mentor.lowestRecent <= LOW_RATING) {
    reasons.push(`Rated ${mentor.lowestRecent} in the last ${RECENT_DAYS} days`);
  }
  return reasons;
}

/**
 * A mentor somebody should look at: who, the score, and the reason on screen —
 * not in a tooltip a phone never shows.
 */
function AttentionCard({ mentor }: { mentor: MentorCard }) {
  const filled = Math.round(mentor.average);
  return (
    <article className="flex min-w-0 flex-col rounded-xl bg-surface shadow-sm">
      <div className="px-4 pt-4 sm:px-5">
        <PersonCell
          person={mentor.who}
          href={`/mentors/${mentor.who.id}`}
          secondary={false}
        >
          <StatusChip severity="attention">Low</StatusChip>
        </PersonCell>
      </div>
      <div className="flex items-end justify-between gap-4 px-4 pb-3 pt-4 sm:px-5">
        <div>
          <div className="text-figure-lg font-semibold leading-none tabular-nums text-ink">
            {mentor.average.toFixed(1)}
          </div>
          <div aria-hidden="true" className="mt-1.5 text-sm tracking-tight text-ink">
            {"★".repeat(filled)}
            <span className="text-line-strong">{"★".repeat(5 - filled)}</span>
          </div>
        </div>
        <dl className="space-y-0.5 text-right text-xs">
          {mentor.general.average !== null && (
            <div>
              <dt className="inline text-muted-fg">Written </dt>
              <dd className="inline tabular-nums text-ink">
                {mentor.general.average.toFixed(1)}
                <span className="text-muted-fg"> · {mentor.general.count}</span>
              </dd>
            </div>
          )}
          {mentor.meetings.average !== null && (
            <div>
              <dt className="inline text-muted-fg">Meetings </dt>
              <dd className="inline tabular-nums text-ink">
                {mentor.meetings.average.toFixed(1)}
                <span className="text-muted-fg"> · {mentor.meetings.count}</span>
              </dd>
            </div>
          )}
        </dl>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line/70 px-4 py-2.5 text-xs sm:px-5">
        <span className="text-warn-ink">{lowReasons(mentor).join(" · ")}</span>
        <span className="text-muted-fg">
          {mentor.lastRated ? `Last ${formatDate(mentor.lastRated)}` : null}
        </span>
      </div>
    </article>
  );
}

/**
 * The score as a tile at the start of a feed row, so a column of them can be
 * scanned for the low ones. The number is the signal and the tint only
 * repeats it — never colour alone.
 */
function ScoreBadge({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-semibold tabular-nums",
        value <= LOW_RATING ? "bg-warn-soft text-warn-ink" : "bg-fill text-ink"
      )}
      aria-label={`${value} out of 5`}
    >
      {value}
    </span>
  );
}

/**
 * One rating in a feed: the score tile, who it is about and when, what was
 * said in ink because the words are the point, and who said it quietly under.
 */
function FeedItem({
  score,
  mentor,
  aside,
  text,
  meta,
}: {
  score: number | null;
  mentor?: { id: string; name: string | null; email: string; avatarUpdatedAt: Date | null };
  aside: string;
  text: string | null;
  meta?: string;
}) {
  return (
    <li className="flex gap-3 px-4 py-3 sm:px-5">
      {score !== null && <ScoreBadge value={score} />}
      <div className="min-w-0 flex-1">
        <div className="flex min-h-9 items-center justify-between gap-3">
          {mentor ? (
            <PersonChip person={mentor} size="sm" href={`/mentors/${mentor.id}`} />
          ) : (
            <span className="text-xs text-muted-fg">{meta ?? ""}</span>
          )}
          <span className="shrink-0 text-xs tabular-nums text-muted-fg">{aside}</span>
        </div>
        {text && (
          <div className="mt-1 text-body">
            <ExpandableText text={text} lines={2} className="text-ink" />
          </div>
        )}
        {mentor && meta && <p className="mt-1 text-xs text-muted-fg">{meta}</p>}
      </div>
    </li>
  );
}
