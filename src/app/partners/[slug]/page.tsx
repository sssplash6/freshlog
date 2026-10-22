import { notFound } from "next/navigation";

import { ExpandableText } from "@/components/expandable-text";
import { Rating } from "@/components/rating";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { PAGE_SIZE, Pagination, parsePage } from "@/components/ui/pagination";
import { PageTitle, Section } from "@/components/ui/section";
import { FILL_CELL, Table, Td, Tr, type Column } from "@/components/ui/table";
import { requirePlatformAdmin } from "@/lib/dal";
import {
  DATE_PRESETS,
  activeFilterCount,
  filterSummary,
  readDateWindow,
  readParam,
  type SearchParams,
} from "@/lib/filters";
import { formatDate } from "@/lib/format";
import {
  partnerFeedbackWhere,
  partnerSummary,
  readPartnerFilters,
} from "@/lib/partner-feedback-queries";
import { normalizeSlug } from "@/lib/partner-feedback";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Partner feedback" };

/** The two kinds as the URL spells them — `readPartnerFilters` reads these. */
const KIND_OPTIONS = [
  { value: "MENTOR", label: "Mentor" },
  { value: "SESSION", label: "Session" },
];

/**
 * Exactly this many stars, not "N or fewer" as on `/feedback`: here the
 * question is as often "who gave us fives" as "who is unhappy", and the query
 * is an equality (`partnerFeedbackWhere`).
 */
const RATING_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({
  value: String(n),
  label: n === 1 ? "1 star" : `${n} stars`,
}));

/** "—" when there is nothing to average; one decimal otherwise. */
function avg(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

/** "1 rating" / "12 ratings". */
function count(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

/**
 * Everything one partner's students have said, and the filters to find any of
 * it.
 *
 * THE SUMMARY, BOTH TABLES AND THE LIST READ THROUGH ONE `where`. "Session 4,
 * last week" reads its own average, its own mentors and its own rows; a
 * filtered list beside an unfiltered average is two answers to one question.
 *
 * The pickers do not. The mentor picker is every mentor with feedback here or
 * ticked now, and the session picker every session number anybody rated —
 * built from the filtered set, they would collapse to the one already chosen
 * and offer no way back.
 *
 * The student's email and name are shown in full: this page is a platform
 * admin's, and the partner's coordinator asks about named students.
 */
export default async function PartnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requirePlatformAdmin();

  // An unknown slug and a malformed one are the same 404. A partner whose
  // form is off is still found: its feedback is still here to read.
  const slug = normalizeSlug((await params).slug);
  const partner = slug
    ? await prisma.feedbackPartner.findUnique({
        where: { slug },
        select: { id: true, slug: true, name: true, active: true },
      })
    : null;
  if (!partner) notFound();

  const query = await searchParams;
  const page = parsePage(readParam(query, "page"));
  const now = new Date();
  const filters = readPartnerFilters(query, now);
  const where = partnerFeedbackWhere(partner.id, filters);
  const basePath = `/partners/${partner.slug}`;

  const [summary, rows, mentors, sessions] = await Promise.all([
    partnerSummary(partner.id, filters, now),
    prisma.partnerFeedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        kind: true,
        studentEmail: true,
        sessionNumber: true,
        name: true,
        rating: true,
        comment: true,
        createdAt: true,
        mentorId: true,
      },
    }),
    prisma.user.findMany({
      where: {
        OR: [
          { partnerFeedback: { some: { partnerId: partner.id } } },
          { partnerMentorships: { some: { partnerId: partner.id } } },
        ],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    prisma.partnerFeedback.groupBy({
      by: ["sessionNumber"],
      where: { partnerId: partner.id, sessionNumber: { not: null } },
      orderBy: { sessionNumber: "asc" },
    }),
  ]);

  // The admin's own page, so a mentor with no name yet is their email — the
  // public form hides such a mentor; here they have to be findable.
  const mentorLabel = new Map(mentors.map((m) => [m.id, m.name ?? m.email]));
  const filtered = activeFilterCount(query) > 0;

  const standing =
    summary.total === 0
      ? undefined
      : [
          `${avg(summary.average)} average`,
          count(summary.total, "rating"),
          `${summary.lastWeek} in the last 7 days`,
        ].join(" · ");

  const mentorColumns: Column[] = [
    { label: "Mentor" },
    { label: "Ratings", align: "right" },
    { label: "Average", align: "right", emphasis: "key" },
  ];
  const sessionColumns: Column[] = [
    { label: "Session" },
    { label: "Ratings", align: "right" },
    { label: "Average", align: "right", emphasis: "key" },
  ];
  const feedbackColumns: Column[] = [
    { label: "Date" },
    { label: "Kind" },
    { label: "About" },
    { label: "Name" },
    { label: "Email" },
    { label: "Rating" },
    { label: "Feedback" },
  ];

  return (
    <div className="space-y-4">
      <PageTitle
        backHref="/partners"
        backLabel="Partners"
        title={partner.name}
        eyebrow={partner.active ? undefined : "Form switched off"}
        subtitle={standing}
        actions={
          <LinkButton href={`${basePath}/settings`} variant="secondary">
            Settings
          </LinkButton>
        }
      />

      <FilterBar
        basePath={basePath}
        params={query}
        q="partnerFeedback"
        selects={[
          { name: "kind", label: "Kind", all: "Both kinds", options: KIND_OPTIONS },
          {
            name: "mentor",
            label: "Mentor",
            all: "All mentors",
            options: mentors.map((m) => ({
              value: m.id,
              label: m.name ?? m.email,
              hint: m.name ? m.email : undefined,
            })),
          },
          {
            // A picker rather than a typed number: it offers only the
            // sessions somebody rated, so it cannot be set to an empty list.
            name: "session",
            label: "Session",
            all: "All sessions",
            options: sessions.flatMap((s) =>
              s.sessionNumber === null
                ? []
                : [{ value: String(s.sessionNumber), label: `Session ${s.sessionNumber}` }]
            ),
          },
          { name: "rating", label: "Rating", all: "Any rating", options: RATING_OPTIONS },
        ]}
        presets={DATE_PRESETS}
        dateRange={readDateWindow(query, now)}
        summary={
          filtered
            ? filterSummary(summary.total, { one: "rating", many: "ratings" }, query)
            : undefined
        }
      />

      {summary.byMentor.length > 0 && (
        <Section
          title="By mentor"
          count={summary.byMentor.length}
          caption="Lowest average first."
        >
          <Table columns={mentorColumns} framed={false} label="By mentor">
            {summary.byMentor.map((m) => (
              <Tr key={m.mentorId}>
                <Td label="Mentor" className={FILL_CELL}>
                  <span className="font-semibold">
                    {mentorLabel.get(m.mentorId) ?? m.name}
                  </span>
                </Td>
                <Td label="Ratings" align="right" tone="muted">
                  {m.count}
                </Td>
                <Td label="Average" align="right" tone="key">
                  {avg(m.average)}
                </Td>
              </Tr>
            ))}
          </Table>
        </Section>
      )}

      {summary.bySession.length > 0 && (
        <Section title="By session" count={summary.bySession.length}>
          <Table columns={sessionColumns} framed={false} label="By session">
            {summary.bySession.map((s) => (
              <Tr key={s.sessionNumber}>
                <Td label="Session" className={FILL_CELL}>
                  <span className="font-semibold">Session {s.sessionNumber}</span>
                </Td>
                <Td label="Ratings" align="right" tone="muted">
                  {s.count}
                </Td>
                <Td label="Average" align="right" tone="key">
                  {avg(s.average)}
                </Td>
              </Tr>
            ))}
          </Table>
        </Section>
      )}

      <Section title="Feedback" count={summary.total}>
        {rows.length === 0 ? (
          filtered ? (
            <EmptyState framed={false} variant="no-results">
              No feedback matches these filters.
            </EmptyState>
          ) : (
            <EmptyState framed={false} title="No feedback yet">
              Students leave it from the partner&apos;s link.
            </EmptyState>
          )
        ) : (
          <Table columns={feedbackColumns} framed={false} label="Feedback">
            {rows.map((f) => (
              <Tr key={f.id}>
                <Td label="Date" tone="muted" className="whitespace-nowrap">
                  {formatDate(f.createdAt)}
                </Td>
                <Td label="Kind" tone="muted">
                  {f.kind === "MENTOR" ? "Mentor" : "Session"}
                </Td>
                <Td label="About" className="whitespace-nowrap">
                  {f.kind === "MENTOR"
                    ? ((f.mentorId && mentorLabel.get(f.mentorId)) ?? "—")
                    : `Session ${f.sessionNumber}`}
                </Td>
                {/* Name and email keep to one line on a pointer: the comment column
                    takes the slack (`FILL_CELL`), and an address broken into
                    four pieces cannot be read back. Stacked on a phone, a long
                    one may still break. */}
                <Td label="Name" className="sm:whitespace-nowrap">
                  {f.name ?? <span className="text-muted-fg">—</span>}
                </Td>
                <Td label="Email" tone="muted" className="wrap-anywhere sm:whitespace-nowrap">
                  {f.studentEmail}
                </Td>
                <Td label="Rating">
                  <Rating value={f.rating} />
                </Td>
                <Td label="Feedback" className={FILL_CELL}>
                  <ExpandableText text={f.comment} lines={2} className="text-ink" />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Section>

      <Pagination
        basePath={basePath}
        params={query}
        page={page}
        total={summary.total}
        unit="ratings"
        className="px-1"
      />
    </div>
  );
}
