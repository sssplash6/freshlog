import { redirect } from "next/navigation";

import { ExpandableText } from "@/components/expandable-text";
import { PersonCell, PersonChip } from "@/components/person-chip";
import { Rating } from "@/components/rating";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { PAGE_SIZE, Pagination, parsePage } from "@/components/ui/pagination";
import { PageTitle, Section } from "@/components/ui/section";
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
  readDateWindow,
  readParam,
  type SearchParams,
} from "@/lib/filters";
import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
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

/**
 * How a mentor who is being scored badly is found: one threshold, as a chip.
 * Four ("1 star" to "4 stars or fewer") was a select nobody tuned.
 */
const LOW_RATINGS = { label: "3 stars or fewer", params: { rating: "3" } };

/** Everything a `PersonChip` or `PersonCell` needs, and nothing else. */
const PERSON = {
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
        // The average alone: the count is the section's.
        subtitle={avg === null ? undefined : `${avg.toFixed(1)} average`}
      />

      {stats._count === 0 ? (
        <EmptyState title="No ratings yet" />
      ) : (
        <>
          {/* Said once, on the page, not only in a tooltip: the promise the
              rating form made the student is the thing a mentor most needs to
              trust here, and a `title` is invisible on a phone. */}
          {/* design-allow: privacy promise */}
          <p className="text-xs text-muted-fg">You never see who rated you.</p>
          <Section title="Ratings" count={stats._count}>
            <ul className="divide-y divide-line">
              {rows.map((f) => (
                <li key={f.id} className="px-4 py-3 sm:px-5">
                  <div className="flex items-center justify-between gap-3">
                    <Rating value={f.rating} />
                    <span className="text-xs tabular-nums text-muted-fg">
                      {formatDate(f.createdAt)}
                    </span>
                  </div>
                  {f.comment && (
                    <div className="mt-1 text-body">
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

  const [
    stats,
    byMentor,
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
      orderBy: [{ _avg: { rating: "asc" } }, { _count: { mentorId: "desc" } }],
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
  const mentors = byMentor.flatMap((row) => {
    const who = person.get(row.mentorId);
    if (!who) return [];
    return [{ who, average: row._avg.rating ?? 0, total: row._count._all }];
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

  const filtered = activeFilterCount(params) > 0;

  const columns: Column[] = [
    { label: "Mentor" },
    { label: "Average", align: "right", emphasis: "key" },
    { label: "Ratings", align: "right" },
  ];

  return (
    <div className="space-y-4">
      {/* No subtitle: the two sections below carry their own counts. */}
      <PageTitle title="Feedback" />

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
        ]}
        presets={[LOW_RATINGS]}
        dateRange={readDateWindow(params, now)}
        // Only once a filter is on: it says the one thing the section counts
        // cannot — that the number is a subset, and here is the way back out.
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

      {/* Every mentor, worst average first — the order is the finding. */}
      {mentors.length > 0 && (
        <Section title="Mentors" count={mentors.length}>
          <Table columns={columns} framed={false}>
            {mentors.map((m) => (
              <MentorRow key={m.who.id} mentor={m} />
            ))}
          </Table>
        </Section>
      )}

      <Section
        title="Ratings"
        count={stats._count}
      >
        {list.length === 0 ? (
          filtered ? (
            <EmptyState framed={false} variant="no-results" title="No ratings match" />
          ) : (
            <EmptyState framed={false} title="No ratings yet" />
          )
        ) : (
          <ul className="divide-y divide-line">
            {list.map((f) => (
              <li key={f.id} className="px-4 py-3 sm:px-5">
                {/* Who it is about and the score on one line; what was said
                    as the body, in ink, because the words are the point of
                    the row; who said it — open to the writer's admins only,
                    and nothing where it is not — and when, as the quiet line
                    under it. */}
                <div className="flex items-center justify-between gap-3">
                  <PersonChip
                    person={f.mentor}
                    size="sm"
                    href={`/mentors/${f.mentor.id}`}
                  />
                  <Rating value={f.rating} />
                </div>
                {f.comment && (
                  <div className="mt-1 text-body">
                    <ExpandableText
                      text={f.comment}
                      lines={2}
                      className="text-ink"
                    />
                  </div>
                )}
                <p className="mt-0.5 text-xs text-muted-fg">
                  {f.student && `${f.student.name ?? f.student.email} · `}
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
};

function MentorRow({ mentor }: { mentor: MentorStanding }) {
  return (
    <Tr>
      <Td label="Mentor" className={FILL_CELL}>
        <PersonCell person={mentor.who} href={`/mentors/${mentor.who.id}`} />
      </Td>
      <Td label="Average" align="right" tone="key">
        <span className="tabular-nums text-ink">
          {mentor.average.toFixed(1)}
        </span>
      </Td>
      <Td label="Ratings" align="right" tone="muted" className="tabular-nums">
        {mentor.total}
      </Td>
    </Tr>
  );
}
