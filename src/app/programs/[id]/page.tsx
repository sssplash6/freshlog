import { ExchangeList } from "@/components/exchange-panel";
import { CrownIcon } from "@/components/icons";
import { AddStudentsForm } from "@/components/forms/add-students-form";
import { PersonChip } from "@/components/person-chip";
import { STUDENT_SORTS, StudentsTable } from "@/components/students-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { ArrowLink } from "@/components/ui/link";
import { PAGE_SIZE, Pagination, parsePage } from "@/components/ui/pagination";
import { Section } from "@/components/ui/section";
import { requireProgramScope } from "@/lib/dal";
import { programExchanges } from "@/lib/exchanges";
import {
  activeFilterCount,
  readParam,
  studentsWhere,
  type SearchParams,
} from "@/lib/filters";
import { programTone } from "@/lib/program-tone";
import { applySort, readSort } from "@/lib/sort";
import { studentsWithHours } from "@/lib/queries";
import type { ViewerContext } from "@/lib/status";

import {
  programCohorts,
  programGrants,
  programOf,
  programPairings,
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
  const [program, pairings, cohorts, exchanges, grants] = await Promise.all([
    programOf(id),
    programPairings(id),
    programCohorts(id),
    programExchanges(id),
    programGrants(id),
  ]);

  const where = studentsWhere(
    query,
    { audience: "staff", userId: user.id, programIds: [id] },
    now
  );
  // THE WHOLE FILTERED SET, then the order, then the page — in that sequence
  // and not the database's. Completed and Remaining are computed per row from
  // the grants and the sessions behind them (`studentsWithHours`), so they do
  // not exist until the rows are in memory: letting SQL take twenty-five rows
  // first and ordering those would order one page of forty and call it the
  // list. A program's roster is the size of a program, and the layout above
  // already reads every row of it for the figures in the masthead.
  const matching = await studentsWithHours(where, {
    now,
    // This page IS one program, so the hours on it are that program's.
    programIds: [id],
  });
  const asked = readSort(
    {
      ...(readParam(query, "sort") ? { sort: readParam(query, "sort") } : {}),
      ...(readParam(query, "dir") ? { dir: readParam(query, "dir") } : {}),
    },
    STUDENT_SORTS
  );
  const ordered = asked
    ? applySort(matching, asked, {
        student: (s) => s.user.name ?? s.user.email,
        completed: (s) => s.completedMinutes,
        total: (s) => s.allottedMinutes,
        remaining: (s) => s.remainingMinutes,
        seen: (s) => s.lastSessionAt,
      })
    : matching;
  const total = ordered.length;
  const students = ordered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const lent = [...exchanges.hosted, ...exchanges.sent];
  const basePath = `/programs/${program.id}`;

  // One line per MENTOR: somebody paired with three cohorts of this program is
  // one person teaching here, not three rows. The cohort names themselves are
  // not on the line — programs are flat by default, so on a list of fourteen
  // it was one bare date beside one name, reading as a mystery rather than a
  // fact. Settings is where a pairing's cohort is set and shown.
  const mentors = new Map<
    string,
    { mentor: (typeof pairings)[number]["mentor"] }
  >();
  for (const p of pairings) {
    const held = mentors.get(p.mentorId);
    mentors.set(p.mentorId, held ?? { mentor: p.mentor });
  }
  const mentorRows = [...mentors.values()];
  const superAdminIds = new Set(
    grants.filter((grant) => grant.role === "ADMIN").map((grant) => grant.user.id),
  );
  const spilled = mentorRows.length - MENTORS_SHOWN;

  return (
    <div className="space-y-4">
      {/* ONE way in, the width of the page, directly under the tabs. Adding
          students was a link in the header AND a text fold above the table —
          the same action twice, in the two shapes least likely to be pressed
          on a phone. The button IS the form now: each tap opens a row above
          it (`add-students-form.tsx`). */}
      <AddStudentsForm
        program={{
          id: program.id,
          name: program.name,
          cohorts: cohorts.map((c) => ({ id: c.id, name: c.name })),
        }}
      />

      {/* The roster, and the mentors beside it. Source order is the phone's
          order: the students first, the rail under them. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <div className="min-w-0 space-y-4">
          <FilterBar
            basePath={basePath}
            params={query}
            q="students"
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
                Add them with the button above.
              </EmptyState>
            )
          ) : (
            <>
              <StudentsTable
                students={students}
                viewer={viewer}
                showProgram={false}
                sorts={STUDENT_SORTS}
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

        </div>

        <Section
          title="Mentors"
          count={mentorRows.length}
          action={
            spilled > 0 ? (
              <ArrowLink
                href={`/mentors?program=${program.id}`}
                className="text-[0.8125rem]"
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
                 .map(({ mentor }) => (
                  // The flag follows the NAME, never the row's far edge.
                  // Justified to the edge it landed on the name's line for a
                  // short name and wrapped below for a long one — the same
                  // chip in two places down one column. Directly after the
                  // name it costs a line only when the name leaves no room.
                  <li
                    key={mentor.id}
                    className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 sm:px-5"
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
                      {superAdminIds.has(mentor.id) && (
                        <span title="Super admin" className="text-warn-ink">
                          <CrownIcon className="h-4 w-4" />
                        </span>
                      )}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Section>

      </div>
    </div>
  );
}
