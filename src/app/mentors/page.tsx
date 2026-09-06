import { RegisterMentorForm } from "@/components/forms/mentor-forms";
import { MentorsTable, type MentorRow } from "@/components/mentors-table";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { PAGE_SIZE, Pagination, parsePage } from "@/components/ui/pagination";
import { PageTitle } from "@/components/ui/section";
import { adminScope, scopeProgramFilter } from "@/lib/authz";
import { ROLES } from "@/lib/constants";
import { requireAdminAccess } from "@/lib/dal";
import {
  MENTOR_PRESETS,
  activeFilterCount,
  filterSummary,
  mentorsWhere,
  readParam,
  type SearchParams,
} from "@/lib/filters";
import { prisma } from "@/lib/prisma";
import { programOptions, toProgramOptions } from "@/lib/queries";
import type { ViewerContext } from "@/lib/status";

/**
 * Every mentor the reader administers.
 *
 * The page it replaces opened with an orange "Awaiting assignment" box, then an
 * always-open registration form, then the list — so two thirds of the first
 * screen were about mentors who were not on it, and the list itself was a stack
 * of cards each carrying a collapsed edit form. Registering is now a fold, and
 * everything you might do to one mentor happens on that mentor's page.
 *
 * SCOPE IS THE FIRST THING THAT HAPPENS. `mentorsWhere` ANDs the reader's
 * grants in ahead of anything the URL says, and the pairing read below carries
 * the same filter: a mentor may work in three programs and be this reader's
 * colleague in one, and the other two are not theirs to read.
 *
 * One consequence worth stating, because the old page did the opposite: a
 * mentor with NO pairing at all — a fresh sign-in waiting to be placed — is in
 * no program, so a scoped admin's list cannot contain them and only a platform
 * admin sees them under the Unassigned chip. That is `canManageMentor`'s rule
 * ("a mentor who is paired with nothing is nobody's to edit but a platform
 * admin's"), and the box this page used to carry ignored it: it listed every
 * unregistered sign-in to every admin, whatever they had been granted.
 */
export default async function MentorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAdminAccess();
  const scope = await adminScope(user);
  const programIds = scopeProgramFilter(scope);
  const params = await searchParams;
  const page = parsePage(readParam(params, "page"));
  // One instant for the whole render, so no two sections can disagree about
  // what today is.
  const now = new Date();
  const viewer: ViewerContext = { audience: "staff", userId: user.id, now };

  const where = mentorsWhere(params, { programIds });
  const inScope = programIds ? { in: [...programIds] } : undefined;

  const [mentors, total, roster, programs] = await Promise.all([
    prisma.user.findMany({
      where,
      // Unassigned first, in the DATABASE rather than over the slice: sorting a
      // page of twenty-five would put this page's stragglers on top and page
      // two's below, which reads as an order and is not one.
      //
      // Pairing count leads, because that is what the chip beside the name
      // means. `MENTOR_UNASSIGNED` fires on no programs OR the UNASSIGNED
      // account state, and the two are not the same person: a dual-role admin
      // who mentors nobody yet stays ACTIVE and still has nowhere to be booked.
      // Sorting on the account column alone left those scattered down a list
      // whose chips all said "Not in any program".
      orderBy: [
        { mentorAssignments: { _count: "asc" } },
        { status: "desc" },
        { name: "asc" },
      ],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        role: true,
        avatarUpdatedAt: true,
      },
    }),
    prisma.user.count({ where }),
    // The unfiltered roster, for the title. The title says how many mentors
    // there are; the bar under it says how many the filter left.
    prisma.user.count({ where: mentorsWhere({}, { programIds }) }),
    programOptions(programIds),
  ]);

  const ids = mentors.map((m) => m.id);

  const [pairings, holdings, ratings] = await Promise.all([
    // Only the pairings of the mentors on this page, and only in programs the
    // reader administers.
    prisma.mentorAssignment.findMany({
      where: {
        mentorId: { in: ids },
        ...(inScope ? { programId: inScope } : {}),
      },
      select: {
        mentorId: true,
        programId: true,
        calendlyUrl: true,
        program: { select: { name: true } },
        cohort: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    // Students holding time from each mentor. An allocation is unique on
    // (student, program, mentor), so a row is a student IN A PROGRAM — the
    // distinct student ids are what makes this a headcount, and it is the same
    // set `mentorOverview` counts on the mentor's own page, so the list and the
    // page cannot disagree about the number.
    prisma.hourAllocation.findMany({
      where: {
        mentorId: { in: ids },
        ...(inScope ? { programId: inScope } : {}),
      },
      select: { mentorId: true, studentId: true },
    }),
    // Scoped on the STUDENT's programs, not the mentor's: a rating written by
    // another program's student is not this reader's to average.
    prisma.mentorFeedback.groupBy({
      by: ["mentorId"],
      where: {
        mentorId: { in: ids },
        ...(inScope
          ? { student: { enrollments: { some: { programId: inScope } } } }
          : {}),
      },
      _avg: { rating: true },
      _count: true,
    }),
  ]);

  const holdingByMentor = new Map<string, number>();
  const heldBy = new Map<string, Set<string>>();
  for (const h of holdings) {
    if (!h.mentorId) continue;
    const seen = heldBy.get(h.mentorId) ?? new Set<string>();
    seen.add(h.studentId);
    heldBy.set(h.mentorId, seen);
  }
  for (const [mentorId, seen] of heldBy) holdingByMentor.set(mentorId, seen.size);
  const ratingByMentor = new Map(ratings.map((r) => [r.mentorId, r]));
  const programsWithCohorts = new Set(
    programs.filter((p) => p.cohorts.length > 0).map((p) => p.id)
  );

  const rows: MentorRow[] = mentors.map((m) => {
    const theirs = pairings.filter((p) => p.mentorId === m.id);
    const rating = ratingByMentor.get(m.id);
    return {
      id: m.id,
      name: m.name,
      email: m.email,
      avatarUpdatedAt: m.avatarUpdatedAt,
      accountStatus: m.status,
      isAdmin: m.role === ROLES.ADMIN,
      programs: theirs.map((p) =>
        p.cohort
          ? `${p.program.name} / ${p.cohort.name}`
          : programsWithCohorts.has(p.programId)
            ? `${p.program.name} (all cohorts)`
            : p.program.name
      ),
      pairings: theirs.length,
      pairingsWithLink: theirs.filter((p) => p.calendlyUrl).length,
      students: holdingByMentor.get(m.id) ?? 0,
      averageRating: rating?._avg.rating ?? null,
      ratingCount: rating?._count ?? 0,
    };
  });

  return (
    <div className="space-y-5">
      <PageTitle
        title={
          <>
            Mentors{" "}
            <span className="font-semibold tabular-nums text-muted-fg">
              · {roster}
            </span>
          </>
        }
      />

      {/* Under the title rather than in its actions row: the fold opens into a
          two-column form with a program picker in it, and a control that pushes
          the page's own heading sideways when it opens is not an action. */}
      <Disclosure label="Register a mentor">
        <RegisterMentorForm programs={toProgramOptions(programs)} />
      </Disclosure>

      <FilterBar
        basePath="/mentors"
        params={params}
        q="mentors"
        selects={
          // One program is not a choice.
          programs.length > 1
            ? [
                {
                  name: "program",
                  label: "Program",
                  all: "All programs",
                  options: programs.map((p) => ({ value: p.id, label: p.name })),
                },
              ]
            : []
        }
        presets={MENTOR_PRESETS}
        summary={filterSummary(total, { one: "mentor", many: "mentors" }, params)}
      />

      <MentorsTable
        rows={rows}
        viewer={viewer}
        empty={
          activeFilterCount(params) > 0 ? (
            // The bar above has already said in words that nothing matched, so
            // this adds the way out and not the count again.
            <EmptyState variant="no-results" title="No mentor matches">
              Check the spelling, or reset to see everyone.
            </EmptyState>
          ) : undefined
        }
      />

      <Pagination
        basePath="/mentors"
        params={params}
        page={page}
        total={total}
        unit="mentors"
      />
    </div>
  );
}
