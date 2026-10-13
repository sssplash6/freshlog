import { STUDENT_SORTS, StudentsTable } from "@/components/students-table";
import { CreateLink } from "@/components/create-link";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { PAGE_SIZE, Pagination, parsePage } from "@/components/ui/pagination";
import { PageTitle } from "@/components/ui/section";
import { adminScope, scopeProgramFilter } from "@/lib/authz";
import { canActAsMentor } from "@/lib/constants";
import { requireUser } from "@/lib/dal";
import {
  activeFilterCount,
  filterSummary,
  readParam,
  readTimeState,
  studentsWhere,
  type SearchParams,
} from "@/lib/filters";
import { prisma } from "@/lib/prisma";
import { applySort, readSort } from "@/lib/sort";
import { timeStateHolds } from "@/lib/status";
import { homeFor, profileOf } from "@/lib/profile";
import { redirect } from "next/navigation";
import { studentsWithHours } from "@/lib/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Students" };

/**
 * The roster, at one address, for everyone entitled to a roster.
 *
 * There were two of these — an admin's list of everybody and a mentor's list
 * of their own — which is one query written twice and two tables to keep in
 * step. It is one page now, and who is reading changes exactly two things:
 * which rows the query may return, and which preset is on when you arrive.
 *
 * A mentor arrives with "Mine" applied. It is a preset and not a hard filter
 * on purpose: a mentor asked to cover for a colleague clears it and finds the
 * student, which is a thing that happens and which a hard filter turns into
 * asking an admin. What they may SEE is decided by reach, not by the chip —
 * `studentsWhere` ANDs the mentor's own reach in underneath, and that reach is
 * everyone enrolled in a program they are assigned to, which is exactly who
 * they may log hours with.
 *
 * Every narrowing is a `where`. The program filter used to be a JS `.filter()`
 * over every student in the school, so the cost of showing one program was the
 * cost of loading all of them.
 */
export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const profile = await profileOf(user);
  const scope = await adminScope(user);
  const isMentor = canActAsMentor(user);
  const administers = scope === "ALL" || scope.size > 0;
  /**
   * Which programs the FIGURES on this page are summed over. Undefined means
   * all of the student's.
   *
   * Only an admin narrows: their grants say which of a two-program student's
   * hours are theirs to read. A mentor's grant list is empty, and an empty
   * list is not "no narrowing" — it reads as "no programs", which blanked
   * every hour, every use-by date and every program chip on the mentor's own
   * roster. Their narrowing is reach, and reach is the `where` below.
   */
  const programIds = administers ? scopeProgramFilter(scope) : undefined;

  // A student has no roster: their own page is their home. Anyone else who
  // neither administers a program nor mentors has nothing to list either.
  if (!administers && !isMentor) redirect(homeFor(user, profile));

  const params = await searchParams;
  const page = parsePage(readParam(params, "page"));
  const asked = readSort(
    {
      ...(readParam(params, "sort") ? { sort: readParam(params, "sort") } : {}),
      ...(readParam(params, "dir") ? { dir: readParam(params, "dir") } : {}),
    },
    STUDENT_SORTS
  );
  const nameOrder = asked?.dir === "desc" ? "desc" : "asc";
  // The figures the database cannot order by, because they are summed per row
  // after it has answered. Naming them here is what decides whether this page
  // pages in SQL or in JavaScript.
  const computedSort = asked != null && asked.key !== "student";
  // A `?time=` chip asks the same question the bell's row does, and the
  // `where` can only ask half of it: that a grant's DATE is in the window,
  // not that its minutes survived to it. `timeStateHolds` answers the rest,
  // row by row, on the same figures the table prints — which means reading
  // every match and counting and paging here, the way a computed sort
  // already does. A spent grant near its date used to count as "expiring".
  const timeFilter = readTimeState(params);
  const readAll = computedSort || timeFilter != null;
  // One instant for the whole page: the "expiring" and "expired" chips and the
  // forfeiture the table shows have to be judged against the same clock, or a
  // student can be in the filtered list and unexpired in the row.
  const now = new Date();

  // Reach, before anything the URL says. An admin sees their granted programs;
  // somebody who only mentors sees the students they reach, and never more.
  // `undefined` is a platform admin.
  const lens = {
    audience: (administers ? "staff" : "mentor") as "staff" | "mentor",
    userId: user.id,
    now,
  };
  const where = studentsWhere(
    params,
    {
      audience: lens.audience,
      userId: user.id,
      ...(administers ? { programIds } : { mentorId: user.id }),
    },
    now
  );

  const [programs, matching, total] = await Promise.all([
    prisma.program.findMany({
      // The programs this reader can meaningfully filter by: an admin's
      // grants, or — for a mentor — the programs they are assigned to, which
      // is exactly the set their roster can contain.
      where: administers
        ? programIds
          ? { id: { in: [...programIds] } }
          : {}
        : { mentorAssignments: { some: { mentorId: user.id } } },
      orderBy: { name: "asc" },
    }),
    // `programIds` twice over on purpose: it narrows WHICH students the `where`
    // returns, and — here — which of each student's programs their hours and
    // their program cell are summed from.
    //
    // NO `slice` WHEN THE READER ASKED FOR A COMPUTED ORDER, and that is the
    // price of the sortable figures. Completed, Remaining, Use by and Last
    // session are derived per row AFTER the query, so ordering by one of them
    // over a page the database has already chosen would order twenty-five rows
    // and call it the roster — a header that changes the URL and not the answer
    // is worse than a header that does nothing.
    //
    // So a computed sort reads the whole matching set and pages it here, the
    // same shape a program's own roster has always had. It costs the same three
    // queries either way; what it costs is rows in memory, and the school this
    // serves has twelve. Ordering by name still slices in the database, because
    // the database can do that one itself.
    studentsWithHours(where, {
      ...(readAll
        ? {}
        : { slice: { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE } }),
      now,
      programIds,
      order: nameOrder,
    }),
    prisma.studentProfile.count({ where }),
  ]);

  const visible = timeFilter
    ? matching.filter((s) => {
        // Filtered to a program, the question is asked of THAT program's
        // figures — a grant spent to its date in one program is not
        // "expiring" because the student's other program still holds time.
        const scoped = readParam(params, "program");
        const figures = scoped ? s.byProgram.get(scoped) : s;
        return figures != null && timeStateHolds(timeFilter, figures, lens);
      })
    : matching;
  // What the summary, the empty branch and the pager count: the rows that
  // remain, when a `?time=` chip has already said how many there are.
  const shown = timeFilter ? visible.length : total;

  const ordered = computedSort
    ? applySort(visible, asked, {
        student: (s) => s.user.name ?? s.user.email,
        completed: (s) => s.completedMinutes,
        total: (s) => s.allottedMinutes,
        remaining: (s) => s.remainingMinutes,
        deadline: (s) => s.expiring?.date,
        seen: (s) => s.lastSessionAt,
      })
    : visible;
  const students = readAll
    ? ordered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : ordered;

  return (
    <div className="space-y-4">
      <PageTitle
        title="Students"
        subtitle={
          administers
            ? // The roster's size, in the same place `/mentors` says its own.
              // Filtered, the bar below says how many matched instead.
              activeFilterCount(params) === 0
              ? `${shown} ${shown === 1 ? "student" : "students"}`
              : undefined
            : // Reach, said plainly: this list is everyone a mentor may log a
              // meeting with, which is wider than the students whose time
              // they hold — those are the caseload on their home page.
              "Everyone in your programs, whoever holds their time."
        }
        // Adding students was only offered by the EMPTY roster, so it vanished
        // the moment the first one arrived. It happens on a program (where the
        // cohort is chosen): one program links straight to its form, several
        // to the list to pick from.
        actions={
          administers && programs.length > 0 ? (
            <CreateLink
              href={
                programs.length === 1 ? `/programs/${programs[0].id}?add=1` : "/programs?for=students"
              }
              label="Add students"
            />
          ) : undefined
        }
      />

      <FilterBar
        basePath="/students"
        params={params}
        q="students"
        selects={
          // One program is not a choice, and a select that offers exactly one
          // option is a fold, a tap and a line of height for nothing.
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
        // NO CHIPS. Mine, Pending, Not signed in, No time, Expiring and Expired
        // were six link-pills wrapping to their own row above a roster of
        // twelve, and every one of them answers a question the table already
        // answers by being read — the status chips, the Remaining column and
        // the Last session column each say the same thing in place. The program
        // is the one narrowing a reader cannot do with their eyes, because the
        // rows they want are simply not on the page.
        //
        // The count only once a filter is on: unfiltered it is the pager's,
        // and the same "8 students" above and below the table was one fact
        // said twice.
        summary={
          activeFilterCount(params) > 0
            ? filterSummary(shown, { one: "student", many: "students" }, params)
            : undefined
        }
      />

      {shown === 0 ? (
        // Titled the way `/mentors` titles its own, so the two empty searches
        // read as one pattern rather than an icon and a stray sentence.
        activeFilterCount(params) > 0 ? (
          <EmptyState variant="no-results" title="No students match">
            Check the spelling, or reset to see everyone.
          </EmptyState>
        ) : (
          <EmptyState
            title="No students yet"
            action={
              administers && programs.length > 0 ? (
                <CreateLink
                  href={
                    programs.length === 1 ? `/programs/${programs[0].id}?add=1` : "/programs?for=students"
                  }
                  label="Add students"
                />
              ) : undefined
            }
          >
            {administers
              ? "Add them on a program; each confirms their name on first sign-in."
              : "You hold time with nobody yet, and nobody's work is on your list."}
          </EmptyState>
        )
      ) : (
        <>
          <StudentsTable
            students={students}
            viewer={lens}
            // Filtered to one program, the student's page leads back to it.
            from={readParam(params, "program") || undefined}
            sorts={STUDENT_SORTS}
          />
          {/* Only when there is a page to turn to: on one page it was the
              roster's size said a second time. */}
          {shown > PAGE_SIZE && (
            <Pagination
              basePath="/students"
              params={params}
              page={page}
              total={shown}
              unit="students"
              className="px-1"
            />
          )}
        </>
      )}
    </div>
  );
}
