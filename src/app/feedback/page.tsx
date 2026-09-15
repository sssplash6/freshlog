import { redirect } from "next/navigation";

import { ExpandableText } from "@/components/expandable-text";
import { PersonCell, PersonChip } from "@/components/person-chip";
import { Rating } from "@/components/rating";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { PAGE_SIZE, Pagination, parsePage } from "@/components/ui/pagination";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, Td, Tr, type Column } from "@/components/ui/table";
import { adminScope, staffLevel, type AdminScope } from "@/lib/authz";
import { canActAsMentor, ROLES } from "@/lib/constants";
import { requireUser } from "@/lib/dal";
import {
  activeFilterCount,
  feedbackWhere,
  filterSummary,
  readDateWindow,
  readParam,
  type SearchParams,
} from "@/lib/filters";
import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { homeFor, profileOf } from "@/lib/profile";
import type { User } from "@/generated/prisma/client";

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
 *   1. A rating OF YOU carried the name of the student who left it. The form
 *      says "Your name isn't shown to the mentor", and nine of the ten admins
 *      also mentor students (`profile.ts`), so for nine of ten mentors that
 *      promise was false: they opened /admin/feedback and read exactly who had
 *      scored them 2. Withheld below, by the reader's own id, in both shapes.
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
  if (user.role === ROLES.STUDENT) redirect("/student/feedback");

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
  const [rows, stats] = await Promise.all([
    prisma.mentorFeedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, rating: true, comment: true, createdAt: true },
    }),
    prisma.mentorFeedback.aggregate({
      where,
      _avg: { rating: true },
      _count: true,
    }),
  ]);
  const avg = stats._avg.rating;

  return (
    <div className="space-y-4">
      <PageTitle
        title="Feedback"
        subtitle={
          avg === null
            ? undefined
            : `${avg.toFixed(1)} · ${count(stats._count, "rating")} · anonymous`
        }
      />

      {stats._count === 0 ? (
        <EmptyState title="No ratings yet">
          Students rate a mentor when they choose to; many never do.
        </EmptyState>
      ) : (
        <>
          <Section title="Ratings" count={stats._count}>
            <ul className="divide-y divide-line">
              {rows.map((f) => (
                <li key={f.id} className="px-4 py-2 sm:px-5">
                  <div className="flex items-center justify-between gap-3">
                    <Rating value={f.rating} />
                    <span className="text-xs text-muted-fg">
                      {formatDate(f.createdAt)}
                    </span>
                  </div>
                  {f.comment && (
                    <div className="mt-1.5 text-sm">
                      <ExpandableText
                        text={f.comment}
                        lines={2}
                        className="text-muted-fg"
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Section>
          <Pagination
            basePath="/feedback"
            params={params}
            page={page}
            total={stats._count}
            unit="ratings"
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

  const [stats, byMentor, lately, rows, rated, programs] = await Promise.all([
    prisma.mentorFeedback.aggregate({
      where,
      _avg: { rating: true },
      _count: true,
    }),
    // The mentors table, in one grouped read. Worst average first — a tie goes
    // to the mentor more people have said it about.
    prisma.mentorFeedback.groupBy({
      by: ["mentorId"],
      where,
      _avg: { rating: true },
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: [{ _avg: { rating: "asc" } }, { _count: { mentorId: "desc" } }],
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
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        mentorId: true,
        mentor: { select: PERSON },
        student: { select: { user: { select: PERSON } } },
      },
    }),
    // Mentors somebody in reach has actually rated — a picker offering the
    // other forty is forty ways to reach an empty list. It doubles as the name
    // lookup for the table above, since every mentor in a filtered group is
    // also a mentor in reach.
    prisma.user.findMany({
      where: { mentorFeedback: { some: inReach } },
      orderBy: { name: "asc" },
      select: PERSON,
    }),
    prisma.program.findMany({
      where: programIds ? { id: { in: [...programIds] } } : {},
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const person = new Map(rated.map((m) => [m.id, m]));
  const lowestRecent = new Map(lately.map((r) => [r.mentorId, r._min.rating]));
  const mentors = byMentor.flatMap((row) => {
    const who = person.get(row.mentorId);
    if (!who) return [];
    const average = row._avg.rating ?? 0;
    const recent = lowestRecent.get(row.mentorId) ?? null;
    return [
      {
        who,
        average,
        total: row._count._all,
        lastRated: row._max.createdAt,
        recent,
        low: average < LOW_AVERAGE || (recent !== null && recent <= LOW_RATING),
      },
    ];
  });

  const list = rows.map((f) => ({
    id: f.id,
    rating: f.rating,
    comment: f.comment,
    createdAt: f.createdAt,
    mentor: f.mentor,
    // The leak, closed at its only source. A rating OF the reader loses the
    // student who left it, whatever grants the reader holds and whichever lens
    // they are in — the promise was made to the student, so it is not the
    // reader's role to trade away.
    student: f.mentorId === user.id ? null : f.student.user,
  }));

  const avg = stats._avg.rating;
  const lowCount = mentors.filter((m) => m.low).length;
  const filtered = activeFilterCount(params) > 0;

  // "4.3 · 48 ratings · 12 mentors, 2 low". The comma, not a fourth dot-
  // separated clause: "· 2 low" beside "· 48 ratings" reads as two low
  // RATINGS, and the number it is actually counting is mentors.
  const standing =
    avg === null
      ? undefined
      : [
          avg.toFixed(1),
          count(stats._count, "rating"),
          lowCount > 0
            ? `${count(mentors.length, "mentor")}, ${lowCount} low`
            : count(mentors.length, "mentor"),
        ].join(" · ");

  const columns: Column[] = [
    { label: "Mentor" },
    { label: "Average", align: "right" },
    { label: "Ratings", align: "right" },
    { label: "Lowest recent", align: "right" },
    { label: "Last rated", align: "right" },
  ];

  const worst = mentors.slice(0, WORST_SHOWN);
  const rest = mentors.slice(WORST_SHOWN);

  return (
    <div className="space-y-4">
      <PageTitle title="Feedback" subtitle={standing} />

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
        // subtitle a few pixels above it; filtered, it says the one thing the
        // subtitle cannot — that the number is a subset, and here is the way
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

      {mentors.length > 0 && (
        <Section
          title="Mentors"
          count={mentors.length}
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

      <Section title="Ratings" count={stats._count}>
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
          <ul className="divide-y divide-line">
            {list.map((f) => (
              <li key={f.id} className="px-4 py-2 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                  <PersonChip
                    person={f.mentor}
                    size="sm"
                    href={`/mentors/${f.mentor.id}`}
                  />
                  <Rating value={f.rating} />
                </div>
                {f.comment && (
                  <div className="mt-1.5 text-sm">
                    <ExpandableText
                      text={f.comment}
                      lines={2}
                      className="text-muted-fg"
                    />
                  </div>
                )}
                <p className="mt-1 text-xs text-muted-fg">
                  {f.student ? (
                    (f.student.name ?? f.student.email)
                  ) : (
                    <span title="A rating of you stays anonymous, as the student was promised.">
                      Anonymous
                    </span>
                  )}
                  {" · "}
                  {formatDate(f.createdAt)}
                </p>
              </li>
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
      />
    </div>
  );
}

/* ------------------------------------------------------------------ parts --- */

type MentorStanding = {
  who: { id: string; name: string | null; email: string; avatarUpdatedAt: Date | null };
  average: number;
  total: number;
  lastRated: Date | null;
  recent: number | null;
  low: boolean;
};

function MentorRow({ mentor }: { mentor: MentorStanding }) {
  return (
    <Tr>
      <Td label="Mentor">
        <PersonCell person={mentor.who} href={`/mentors/${mentor.who.id}`}>
          {mentor.low && <StatusChip severity="attention">Low</StatusChip>}
        </PersonCell>
      </Td>
      <Td label="Average" align="right">
        <span className="font-semibold tabular-nums text-ink">
          {mentor.average.toFixed(1)}
        </span>
        <AverageStars value={mentor.average} />
      </Td>
      <Td label="Ratings" align="right" className="tabular-nums text-muted-fg">
        {mentor.total}
      </Td>
      <Td label="Lowest recent" align="right">
        {mentor.recent === null ? (
          <span className="text-muted-fg">—</span>
        ) : (
          <span className="tabular-nums text-ink">{mentor.recent}</span>
        )}
      </Td>
      <Td label="Last rated" align="right" className="text-muted-fg">
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
      className="ml-1.5 align-middle text-[0.625rem] tracking-tight text-ink"
    >
      {"★".repeat(filled)}
      <span className="text-line">{"★".repeat(5 - filled)}</span>
    </span>
  );
}
