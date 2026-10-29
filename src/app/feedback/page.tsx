import Link from "next/link";
import { redirect } from "next/navigation";

import { ExpandableText } from "@/components/expandable-text";
import { ChevronRightIcon } from "@/components/icons";
import { PersonCell, PersonChip } from "@/components/person-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { Eyebrow, PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { FILL_CELL, Table, Td, Tr } from "@/components/ui/table";
import {
  adminScope,
} from "@/lib/authz";
import { canActAsMentor, inStudentLens } from "@/lib/constants";
import { requireUser } from "@/lib/dal";
import {
  KIND_PRESETS,
  LOW_AVERAGE,
  LOW_RATING,
  lowReasons,
  MEETING_PAGE,
  MINE,
  RATING_OPTIONS,
  RECENT_DAYS,
  ownFeedback,
  readablePrograms,
  staffFeedback,
  tallyStars,
} from "@/lib/screens/feedback";
import {
  filterHref,
  filterSummary,
  ratingLabel,
  readDateWindow,
  readParam,
  readRatingRange,
  type SearchParams,
} from "@/lib/filters";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";

import {
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

/** "1 rating" / "12 ratings", so no call site concatenates its own plural. */
function count(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

/** The same page with one rating narrowed to, or widened back out when it is on. */
function starHref(params: SearchParams, star: number): string {
  const on = readRatingRange(params) === star;
  return filterHref("/feedback", params, { rating: on ? undefined : String(star) });
}

/** The same page narrowed to one mentor's ratings. */
function mentorHref(params: SearchParams, mentorId: string): string {
  return filterHref("/feedback", params, { mentor: mentorId });
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
  const { range, rows, listCount, stats, spread, own } = await ownFeedback({ user, params, page });

  return (
    <div className="space-y-4">
      <PageTitle title="Feedback" />

      {own && (
        <Overview
          average={own.average}
          total={own.total}
          basis="both kinds pooled"
          spread={{
            title: "Written ratings",
            counts: tallyStars(
              spread.map((r) => [r.rating, r._count._all] as const)
            ),
          }}
          starHref={(star) => starHref(params, star)}
          activeStar={typeof range === "number" ? range : undefined}
          clearHref={
            range === undefined
              ? undefined
              : filterHref("/feedback", params, { rating: undefined })
          }
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
          <Section
            title="Ratings"
            count={listCount}
            caption={
              range === undefined ? (
                ANONYMOUS
              ) : (
                <>
                  {ratingLabel(params)} only ·{" "}
                  <Link
                    href={filterHref("/feedback", params, { rating: undefined })}
                    scroll={false}
                    className="text-brand hover:underline"
                  >
                    Show all
                  </Link>
                </>
              )
            }
          >
            {rows.length === 0 ? (
              <EmptyState framed={false} variant="no-results">
                None of your ratings is {ratingLabel(params)}.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((f) => (
                  <FeedItem
                    key={f.id}
                    score={f.rating}
                    scoreHref={starHref(params, f.rating)}
                    text={f.comment}
                    aside={formatDate(f.createdAt)}
                  />
                ))}
              </ul>
            )}
          </Section>
          <Pagination
            basePath="/feedback"
            params={params}
            page={page}
            total={listCount}
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
  const {
    now,
    kind,
    wantWritten,
    wantMeetings,
    meetingPage,
    programScores,
    mentors,
    list,
    lowCount,
    filtered,
    columns,
    asked,
    flagged,
    others,
    general,
    meetingTotal,
    range,
    clearRating,
    bothKinds,
    kindHref,
    basis,
    stats,
    rated,
    programs,
    meetingStats,
    meetingRows,
    formSpread,
    meetingSpread,
    writtenAll,
    meetingsRatedAll,
    avg,
    ratedCount,
  } = await staffFeedback({ user, programIds, params, page });

  return (
    <div className="space-y-4">
      <PageTitle title="Feedback" />

      {/* Shown whenever anybody in reach has been rated, even when the
          filters leave nothing: the bars and figures are how the filters are
          taken off again. */}
      {rated.length > 0 && (
        <Overview
          average={avg}
          total={ratedCount}
          basis={basis}
          spread={{
            title:
              kind === "written"
                ? "Written ratings"
                : kind === "meetings"
                  ? "Meeting ratings"
                  : "Every rating",
            counts: tallyStars([
              ...formSpread.map((r) => [r.rating, r._count._all] as const),
              ...meetingSpread.map(
                (r) => [r.studentRating, r._count._all] as const
              ),
            ]),
          }}
          starHref={(star) => starHref(params, star)}
          activeStar={typeof range === "number" ? range : undefined}
          clearHref={range === undefined ? undefined : clearRating}
          figures={[
            {
              label: "Need attention",
              value: String(lowCount),
              hint: `of ${count(mentors.length, "mentor")}`,
              tone: lowCount > 0 ? "attention" : "ink",
              href: lowCount > 0 ? "#attention" : undefined,
            },
            {
              label: "Written ratings",
              value: String(writtenAll ?? general),
              href: kindHref("written", "written"),
              active: kind === "written",
            },
            {
              label: "Meetings rated",
              value: String(meetingsRatedAll ?? meetingTotal),
              href: kindHref("meetings", "meetings"),
              active: kind === "meetings",
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
        presets={canActAsMentor(user) ? [...KIND_PRESETS, MINE] : KIND_PRESETS}
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
          id="attention"
          title="Needs attention"
          count={flagged.length}
          caption={`Under ${LOW_AVERAGE}, or a ${LOW_RATING} or lower in ${RECENT_DAYS} days.`}
          bare
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {flagged.map((m) => (
            <AttentionCard
              key={m.who.id}
              mentor={m}
              ratingsHref={mentorHref(params, m.who.id)}
            />
          ))}
        </Section>
      )}

      {others.length > 0 && (
        <Section
          title={flagged.length > 0 ? "Other mentors" : "Mentors"}
          count={others.length}
          caption={
            asked
              ? `Click a heading to reorder. Recent is the last ${RECENT_DAYS} days.`
              : `Worst first; click a heading to reorder. Recent is the last ${RECENT_DAYS} days.`
          }
        >
          <Table columns={columns} framed={false}>
            {others.map((m) => (
              <MentorRow
                key={m.who.id}
                mentor={m}
                ratingsHref={mentorHref(params, m.who.id)}
              />
            ))}
          </Table>
        </Section>
      )}

      {/* What was said, the two kinds side by side from `lg` up: the words
          are read together, and stacked the meeting ratings sat a whole
          page of comments below the mentors they explain. */}
      <div className={cn("grid items-start gap-4", !kind && "lg:grid-cols-2")}>
        {wantWritten && (
        <div className="min-w-0 space-y-2">
          <Section
            id="written"
            eyebrow="Anonymous to the mentor"
            title="Written ratings"
            count={stats._count}
            caption={
              kind && (
                <Link href={bothKinds} scroll={false} className="text-brand hover:underline">
                  Show meeting ratings too
                </Link>
              )
            }
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
                    scoreHref={starHref(params, f.rating)}
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
        )}

        {wantMeetings && (
        <div className="min-w-0 space-y-2">
          <Section
            id="meetings"
            eyebrow={
              meetingStats._avg.studentRating === null
                ? "One meeting each"
                : `${meetingStats._avg.studentRating.toFixed(1)} average · one meeting each`
            }
            title="Meeting ratings"
            count={meetingStats._count}
            caption={
              kind && (
                <Link href={bothKinds} scroll={false} className="text-brand hover:underline">
                  Show written ratings too
                </Link>
              )
            }
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
                    scoreHref={
                      s.studentRating === null
                        ? undefined
                        : starHref(params, s.studentRating)
                    }
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
        )}
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

/**
 * One mentor in the table. The name opens the mentor; the ratings count
 * narrows THIS page to them, which is where what was said about them is.
 */
function MentorRow({
  mentor,
  ratingsHref,
}: {
  mentor: MentorCard;
  ratingsHref: string;
}) {
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
        <Link
          href={ratingsHref}
          scroll={false}
          title="Only this mentor's ratings"
          className="hover:text-ink hover:underline"
        >
          {partCounts(mentor)}
        </Link>
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
 * The page's one lead, and what stands behind it: the combined score, how the
 * ratings spread across 1 to 5, and two or three quieter counts.
 *
 * One card in three bands divided by hairlines, the `StatStrip` shape, with
 * the spread where its second figure would be. The bars are ink, not orange:
 * orange means hours, and a column of it here would read as time.
 *
 * EVERYTHING THAT IS A COUNT IS A LINK TO WHAT IT COUNTS. A bar narrows the
 * page to that star, a figure to that kind or down to the mentors it counts.
 * A page that said "1 rating of one star" and offered no way to read it was
 * the complaint this answers.
 */
function Overview({
  average,
  total,
  basis,
  spread,
  figures,
  starHref,
  activeStar,
  clearHref,
}: {
  /** `null` once the filters leave nothing to average. */
  average: number | null;
  total: number;
  /** "both kinds pooled", "written ratings": what the total is made of. */
  basis: string;
  spread: { title: string; counts: number[] };
  figures: {
    label: string;
    value: string;
    hint?: string;
    tone?: "ink" | "attention";
    /** Where the figure leads. A `#anchor` scrolls; anything else filters. */
    href?: string;
    /** The figure is the narrowing currently in force. */
    active?: boolean;
  }[];
  /** The link a star's bar is. */
  starHref: (star: number) => string;
  /** The one star the page is narrowed to, if any. */
  activeStar?: number;
  /** Offered beside the bars while any rating window is on. */
  clearHref?: string;
}) {
  const most = Math.max(1, ...spread.counts);
  const filled = average === null ? 0 : Math.round(average);
  return (
    <div className="@container">
      <div className="grid divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-sm @3xl:grid-cols-[1fr_1.6fr_1fr] @3xl:divide-x @3xl:divide-y-0">
        <div className="min-w-0 px-4 py-4 @3xl:px-5 @3xl:py-5">
          <Eyebrow>Combined score</Eyebrow>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-lead font-semibold tabular-nums text-ink">
              {average === null ? "—" : average.toFixed(1)}
            </span>
            <span className="text-sm text-muted-fg">of 5</span>
          </div>
          <div aria-hidden="true" className="mt-1 text-title tracking-tight text-ink">
            {"★".repeat(filled)}
            <span className="text-line-strong">{"★".repeat(5 - filled)}</span>
          </div>
          <p className="mt-2 text-xs text-muted-fg">
            {total === 0
              ? "No ratings match these filters."
              : `From ${count(total, "rating")}, ${basis}.`}
          </p>
        </div>

        <div className="min-w-0 px-4 py-4 @3xl:px-5 @3xl:py-5">
          <div className="flex items-baseline justify-between gap-3">
            <Eyebrow>{spread.title}</Eyebrow>
            {clearHref && (
              <Link
                href={clearHref}
                scroll={false}
                className="text-xs font-medium text-brand hover:underline"
              >
                Any rating
              </Link>
            )}
          </div>
          <ul className="mt-2 -mx-2 space-y-0.5">
            {[5, 4, 3, 2, 1].map((star) => {
              const n = spread.counts[star - 1];
              const active = activeStar === star;
              return (
                <li key={star}>
                  <Link
                    href={starHref(star)}
                    // Narrowing is not going somewhere: the reader stays
                    // where they were looking, the same rule the chips keep.
                    scroll={false}
                    aria-current={active ? "true" : undefined}
                    title={
                      active
                        ? "Show every rating"
                        : `Only ${star === 1 ? "1-star" : `${star}-star`} ratings`
                    }
                    className={cn(
                      "grid grid-cols-[2.25rem_1fr_2.5rem] items-center gap-3 rounded-md px-2 py-1 text-xs transition-colors hover:bg-fill",
                      active && "bg-fill"
                    )}
                  >
                    <span
                      className={cn(
                        "tabular-nums",
                        active ? "font-semibold text-ink" : "text-muted-fg"
                      )}
                    >
                      {star} ★
                    </span>
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
                    <span
                      className={cn(
                        "text-right tabular-nums text-ink",
                        active && "font-semibold"
                      )}
                    >
                      {n}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="grid min-w-0 content-center divide-y divide-line">
          {figures.map((f) => {
            const body = (
              <>
                <span
                  className={cn(
                    "text-xs font-medium",
                    f.active ? "text-ink" : "text-muted-fg"
                  )}
                >
                  {f.label}
                </span>
                <span className="flex items-baseline gap-1.5 text-right">
                  <span
                    className={cn(
                      "text-figure-md font-semibold tabular-nums",
                      f.tone === "attention" ? "text-warn-ink" : "text-ink"
                    )}
                  >
                    {f.value}
                  </span>
                  {f.hint && <span className="text-xs text-muted-fg">{f.hint}</span>}
                  {f.href && (
                    <ChevronRightIcon
                      className={cn(
                        "h-3.5 w-3.5 self-center",
                        f.active ? "text-ink" : "text-muted-fg"
                      )}
                    />
                  )}
                </span>
              </>
            );
            const className =
              "flex items-baseline justify-between gap-3 px-4 py-3 @3xl:px-5";
            return f.href ? (
              <Link
                key={f.label}
                href={f.href}
                // A `#` jumps to the section it counts; a filter stays put.
                scroll={f.href.startsWith("#") ? undefined : false}
                aria-current={f.active ? "true" : undefined}
                title={f.active ? "Show both kinds" : undefined}
                className={cn(
                  className,
                  "transition-colors hover:bg-fill/60",
                  f.active && "bg-fill/60"
                )}
              >
                {body}
              </Link>
            ) : (
              <div key={f.label} className={className}>
                {body}
              </div>
            );
          })}
        </div>
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


/**
 * A mentor somebody should look at: who, the score, and the reason on screen —
 * not in a tooltip a phone never shows.
 */
function AttentionCard({
  mentor,
  ratingsHref,
}: {
  mentor: MentorCard;
  ratingsHref: string;
}) {
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
        <span className="flex items-baseline gap-3">
          <span className="text-muted-fg">
            {mentor.lastRated ? `Last ${formatDate(mentor.lastRated)}` : null}
          </span>
          <Link
            href={ratingsHref}
            scroll={false}
            className="font-medium text-brand hover:underline"
          >
            Their ratings
          </Link>
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
function ScoreBadge({ value, href }: { value: number; href?: string }) {
  const className = cn(
    "grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-semibold tabular-nums",
    value <= LOW_RATING ? "bg-warn-soft text-warn-ink" : "bg-fill text-ink"
  );
  if (!href) {
    return (
      <span className={className} aria-label={`${value} out of 5`}>
        {value}
      </span>
    );
  }
  // The tile narrows the page to this score, so one bad rating leads to
  // every other one like it.
  return (
    <Link
      href={href}
      scroll={false}
      title={`Only ${value}-star ratings`}
      aria-label={`${value} out of 5 — only ${value}-star ratings`}
      className={cn(className, "transition-shadow hover:ring-2 hover:ring-line-strong")}
    >
      {value}
    </Link>
  );
}

/**
 * One rating in a feed: the score tile, who it is about and when, what was
 * said in ink because the words are the point, and who said it quietly under.
 */
function FeedItem({
  score,
  scoreHref,
  mentor,
  aside,
  text,
  meta,
}: {
  score: number | null;
  /** Where the score tile leads: the page narrowed to that score. */
  scoreHref?: string;
  mentor?: { id: string; name: string | null; email: string; avatarUpdatedAt: Date | null };
  aside: string;
  text: string | null;
  meta?: string;
}) {
  return (
    <li className="flex gap-3 px-4 py-3 sm:px-5">
      {score !== null && <ScoreBadge value={score} href={scoreHref} />}
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
