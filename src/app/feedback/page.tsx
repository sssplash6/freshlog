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
import { FILL_CELL, Table, Td, Tr, type Column } from "@/components/ui/table";
import {
  adminScope,
  adminWriteScope,
  staffLevel,
  type AdminScope,
} from "@/lib/authz";
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

/** The promise the rating form made the student, repeated where it is kept. */
const ANONYMOUS =
  "Ratings of you are anonymous. Students' names are never shown to you.";

/**
 * Who may see the writer, said where the staff list shows names.
 *
 * For a leader every row is anonymous and this says why; for an admin the
 * named rows are the ones their grants reach, and this says why the rest are
 * not.
 */
const ADMIN_ONLY =
  "Who wrote a rating is visible only to that student's admins.";

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
          {/* Said on the page, not only in a tooltip: the promise the rating
              form made the student is the thing a mentor most needs to trust
              here, and a `title` is invisible on a phone. */}
          <Section title="Ratings" count={stats._count} caption={ANONYMOUS}>
            <ul className="divide-y divide-line">
              {rows.map((f) => (
                <li key={f.id} className="px-4 py-3 sm:px-5">
                  <div className="flex items-center justify-between gap-3">
                    <Rating value={f.rating} />
                    <span className="text-[0.8125rem] tabular-nums text-muted-fg">
                      {formatDate(f.createdAt)}
                    </span>
                  </div>
                  {f.comment && (
                    <div className="mt-1 text-[0.9375rem]">
                      <ExpandableText
                        text={f.comment}
                        lines={2}
                        className="text-ink"
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

  const [
    stats,
    byMentor,
    lately,
    rows,
    rated,
    programs,
    writeScope,
  ] = await Promise.all([
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
      where: { mentorFeedback: { some: inReach } },
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
    { label: "Average", align: "right", emphasis: "key" },
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

      <Section
        title="Ratings"
        count={stats._count}
        // Said on the page, not only in a tooltip: whether a name or
        // "Anonymous" prints under a row, this is the rule both are drawn by.
        caption={list.length > 0 ? ADMIN_ONLY : undefined}
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
          <ul className="divide-y divide-line">
            {list.map((f) => (
              <li key={f.id} className="px-4 py-3 sm:px-5">
                {/* Who it is about and the score on one line; what was said
                    as the body, in ink, because the words are the point of
                    the row; who said it — open to the writer's admins only —
                    and when, as the quiet line under it. */}
                <div className="flex items-center justify-between gap-3">
                  <PersonChip
                    person={f.mentor}
                    size="sm"
                    href={`/mentors/${f.mentor.id}`}
                  />
                  <Rating value={f.rating} />
                </div>
                {f.comment && (
                  <div className="mt-1 text-[0.9375rem]">
                    <ExpandableText
                      text={f.comment}
                      lines={2}
                      className="text-ink"
                    />
                  </div>
                )}
                <p className="mt-0.5 text-[0.8125rem] text-muted-fg">
                  {f.student ? (f.student.name ?? f.student.email) : "Anonymous"}
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
        className="px-1"
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
      <Td label="Mentor" className={FILL_CELL}>
        <PersonCell person={mentor.who} href={`/mentors/${mentor.who.id}`}>
          {mentor.low && <StatusChip severity="attention">Low</StatusChip>}
        </PersonCell>
      </Td>
      <Td label="Average" align="right" tone="key">
        <span className="tabular-nums text-ink">
          {mentor.average.toFixed(1)}
        </span>
        <AverageStars value={mentor.average} />
      </Td>
      <Td label="Ratings" align="right" tone="muted" className="tabular-nums">
        {mentor.total}
      </Td>
      <Td label="Lowest recent" align="right">
        {mentor.recent === null ? (
          <span className="text-muted-fg">—</span>
        ) : (
          <span className="tabular-nums text-ink">{mentor.recent}</span>
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
      className="ml-1.5 align-middle text-[0.6875rem] tracking-tight text-ink"
    >
      {"★".repeat(filled)}
      <span className="text-fill-strong">{"★".repeat(5 - filled)}</span>
    </span>
  );
}
