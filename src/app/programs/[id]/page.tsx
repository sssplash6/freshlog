import { ExchangeList } from "@/components/exchange-panel";
import { AddStudentsForm } from "@/components/forms/add-students-form";
import { PersonChip } from "@/components/person-chip";
import { StudentsTable } from "@/components/students-table";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { ArrowLink } from "@/components/ui/link";
import { PAGE_SIZE, Pagination, parsePage } from "@/components/ui/pagination";
import { Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { requireProgramScope } from "@/lib/dal";
import { programExchanges } from "@/lib/exchanges";
import {
  activeFilterCount,
  filterSummary,
  readParam,
  studentsWhere,
  type SearchParams,
} from "@/lib/filters";
import { formatDate, formatDuration } from "@/lib/format";
import { programTotals } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { programTone } from "@/lib/program-tone";
import { recentMeetings, studentsWithHours } from "@/lib/queries";
import type { ViewerContext } from "@/lib/status";

import {
  programCohorts,
  programOf,
  programPairings,
  programStudents,
  requestNow,
} from "../reads";

/** Past ten, a list of mentors is a page of its own. */
const MENTORS_SHOWN = 10;

/**
 * A program IS its roster.
 *
 * Opening one used to land on "Overview" — a mentors list, an exchange panel
 * and one line about the last session — and the students were a tab away. That
 * is the wrong first screen: nobody administers a program to read a summary of
 * it, they open it to find a person, and the summary already sits in the
 * header the layout draws above this (students · mentors · hours remaining).
 * So the roster is the page, the mentors moved to a rail beside it where they
 * are still one glance away, and the Overview tab is gone with the duplicate
 * it stood for.
 *
 * The list itself is `/students` (§6.8) with the program fixed: same table,
 * same `where`, same paging. The program is a SCOPE rather than a param, so a
 * `?program=` arriving from somewhere else ANDs against it and can only narrow
 * (`lib/filters.ts`, rule 3).
 *
 * NO FILTER CHIPS AND NO COHORT SELECT, on the owner's instruction (12
 * September 2026): a search box over a program's own roster is the whole
 * control. The presets still work as URLs — `?time=expiring` from the bell
 * narrows this list exactly as it did — they are simply not offered as six
 * pills above a table that is usually shorter than they are.
 */
export default async function ProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const user = await requireProgramScope(id);
  const query = await searchParams;
  const page = parsePage(readParam(query, "page"));
  // One instant, shared with the layout above: a use-by date must not be
  // judged twice by two sections reading the clock separately.
  const now = requestNow();
  const viewer: ViewerContext = { audience: "staff", userId: user.id, now };

  // The first three are the layout's reads, memoised: opening a program asks
  // for its row, its roster and its pairings once between the two files.
  const [program, roster, pairings, cohorts, exchanges, [lastSession]] =
    await Promise.all([
      programOf(id),
      programStudents(id),
      programPairings(id),
      programCohorts(id),
      programExchanges(id),
      recentMeetings({ programId: id, take: 1 }),
    ]);

  const where = studentsWhere(
    query,
    { audience: "staff", userId: user.id, programIds: [id] },
    now
  );
  const [students, total] = await Promise.all([
    studentsWithHours(where, {
      slice: { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE },
      now,
      // This page IS one program, so the hours on it are that program's.
      programIds: [id],
    }),
    prisma.studentProfile.count({ where }),
  ]);

  // §8.6: the one helper, over the unsliced roster — never a second reducer.
  const totals = programTotals(roster);
  const lent = [...exchanges.hosted, ...exchanges.sent];
  const basePath = `/programs/${program.id}`;

  // One line per MENTOR: somebody paired with three cohorts of this program is
  // one person teaching here, not three rows.
  const mentors = new Map<
    string,
    {
      mentor: (typeof pairings)[number]["mentor"];
      cohorts: string[];
      missingLink: boolean;
    }
  >();
  for (const p of pairings) {
    const held = mentors.get(p.mentorId);
    const row = held ?? { mentor: p.mentor, cohorts: [], missingLink: false };
    if (p.cohort) row.cohorts.push(p.cohort.name);
    if (!p.calendlyUrl) row.missingLink = true;
    mentors.set(p.mentorId, row);
  }
  const mentorRows = [...mentors.values()];
  const spilled = mentorRows.length - MENTORS_SHOWN;

  return (
    <div className="space-y-4">
      {/* ONE way in, the width of the page, directly under the tabs. Adding
          students was a link in the header AND a text fold above the table —
          the same action twice, in the two shapes least likely to be pressed
          on a phone. The details are asked for only once it is tapped, and the
          form's own "+ Add another student" is how a second one is added. */}
      <Disclosure
        variant="button"
        label="Add students"
        hint="Each confirms their own name and Telegram handle on first sign-in."
      >
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
          <AddStudentsForm
            program={{
              id: program.id,
              name: program.name,
              cohorts: cohorts.map((c) => ({ id: c.id, name: c.name })),
            }}
          />
        </div>
      </Disclosure>

      {/* The roster, and the mentors beside it. Source order is the phone's
          order: the students first, the rail under them. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
        <div className="min-w-0 space-y-4">
          <FilterBar
            basePath={basePath}
            params={query}
            q="students"
            summary={filterSummary(
              total,
              { one: "student", many: "students" },
              query
            )}
          />

          {total === 0 ? (
            activeFilterCount(query) > 0 ? (
              // The bar above has just said in words that nothing matched, so
              // this adds the way out and not the count again.
              <EmptyState variant="no-results">
                Check the spelling, or reset to see everyone.
              </EmptyState>
            ) : (
              <EmptyState title="Nobody enrolled">
                Add them with the button above; each confirms their name on
                first sign-in.
              </EmptyState>
            )
          ) : (
            <>
              <StudentsTable
                students={students}
                viewer={viewer}
                showProgram={false}
              />
              <Pagination
                basePath={basePath}
                params={query}
                page={page}
                total={total}
                unit="students"
              />
            </>
          )}

          {/* Students this program took in, and students it lent out — both, in
              one list, because an admin's question is the same either way: is
              somebody delivering the hours that were promised? The rows are
              read-only here. A placement is called off from the student's own
              page, where the ledger it would take with it is on screen. */}
          {lent.length > 0 && (
            <Section
              eyebrow="Between programs"
              title="Exchange"
              count={lent.length}
              caption="Hours one program promises, another delivers"
            >
              <ExchangeList
                exchanges={lent}
                viewer={viewer}
                showStudent
                canReturn={() => false}
              />
            </Section>
          )}

          {/* The delivery line, carrying the two figures the removed stat strip
              was the only place to read — logged and missed — and now linking
              to the ledger they came from. */}
          <p className="text-sm text-muted-fg">
            {lastSession
              ? `Last session ${formatDate(lastSession.date)} by ${lastSession.mentor.name ?? lastSession.mentor.email}`
              : "No sessions have been logged in this program"}
            {` · ${formatDuration(totals.completed)} completed`}
            {totals.missed > 0 && ` · ${formatDuration(totals.missed)} missed`}
            {" · "}
            {/* The figures above are lifetime. This is how somebody asks the
                same question of a week: the ledger, already filtered to this
                program, with the date chips on it. */}
            <ArrowLink
              href={`/sessions?program=${program.id}`}
              className="text-[13px]"
            >
              All sessions
            </ArrowLink>
          </p>
        </div>

        <Section
          title="Mentors"
          count={mentorRows.length}
          action={
            spilled > 0 ? (
              <ArrowLink
                href={`/mentors?program=${program.id}`}
                className="text-[13px]"
              >
                All mentors
              </ArrowLink>
            ) : undefined
          }
        >
          {mentorRows.length === 0 ? (
            <p className="px-4 py-2 text-sm text-muted-fg sm:px-5">
              Nobody teaches here yet. Settings pairs a mentor with the program.
            </p>
          ) : (
            <ul className="divide-y divide-line/60 text-sm">
              {mentorRows
                .slice(0, MENTORS_SHOWN)
                .map(({ mentor, cohorts: paired, missingLink }) => (
                  <li
                    key={mentor.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2 sm:px-5"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      {/* "Their mentors can have matching colours." This is the
                          one page where that is unambiguous: every row belongs
                          to this program, so the chip can spend its hue on the
                          place. On /mentors, where a mentor may appear under
                          three programs, they keep their own. */}
                      <PersonChip
                        person={mentor}
                        size="sm"
                        href={`/mentors/${mentor.id}`}
                        tone={programTone(program.id)}
                      />
                      {paired.length > 0 && (
                        <span className="text-xs text-muted-fg">
                          {paired.join(" · ")}
                        </span>
                      )}
                    </span>
                    {missingLink && (
                      <StatusChip severity="attention">
                        No booking link
                      </StatusChip>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
