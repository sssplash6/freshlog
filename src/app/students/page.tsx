import { StudentsTable } from "@/components/students-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { PAGE_SIZE, Pagination, parsePage } from "@/components/ui/pagination";
import { PageTitle } from "@/components/ui/section";
import { adminScope, scopeProgramFilter } from "@/lib/authz";
import { canActAsMentor } from "@/lib/constants";
import { requireUser } from "@/lib/dal";
import {
  MINE_PRESET,
  STUDENT_PRESETS,
  activeFilterCount,
  filterSummary,
  readParam,
  studentsWhere,
  type SearchParams,
} from "@/lib/filters";
import { prisma } from "@/lib/prisma";
import { readSort } from "@/lib/sort";
import { homeFor, profileOf } from "@/lib/profile";
import { redirect } from "next/navigation";
import { studentsWithHours } from "@/lib/queries";

/**
 * The roster, at one address, for everyone entitled to a roster.
 *
 * There were two of these — an admin's list of everybody and a mentor's list
 * of their own — which is one query written twice and two tables to keep in
 * step. It is one page now, and who is reading changes exactly two things:
 * which rows the query may return, and which preset is on when you arrive.
 *
 * A mentor arrives with "Mine" applied. It is a preset and not a hard filter
 * on purpose: a mentor asked to cover for a colleague can clear it and find
 * the student, which is a thing that happens and which a hard filter turns
 * into asking an admin. What they may SEE is decided by reach, not by the
 * chip — `studentsWhere` ANDs the mentor's own reach in underneath.
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
  const programIds = scopeProgramFilter(scope);
  const isMentor = canActAsMentor(user);
  const administers = scope === "ALL" || scope.size > 0;

  // A student has no roster: their own page is their home. Anyone else who
  // neither administers a program nor mentors has nothing to list either.
  if (!administers && !isMentor) redirect(homeFor(user, profile));

  const params = await searchParams;
  const page = parsePage(readParam(params, "page"));
  // The one column this roster can honestly order by. The rest are computed
  // per row after the query has sliced the list into pages.
  const asked = readSort(
    {
      ...(readParam(params, "sort") ? { sort: readParam(params, "sort") } : {}),
      ...(readParam(params, "dir") ? { dir: readParam(params, "dir") } : {}),
    },
    ["student"] as const
  );
  const nameOrder = asked?.dir === "desc" ? "desc" : "asc";
  // One instant for the whole page: the "expiring" and "expired" chips and the
  // forfeiture the table shows have to be judged against the same clock, or a
  // student can be in the filtered list and unexpired in the row.
  const now = new Date();

  // Reach, before anything the URL says. An admin sees their granted programs;
  // somebody who only mentors sees the students they reach, and never more,
  // whether or not the "Mine" chip is on. `undefined` is a platform admin.
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

  const [programs, students, total] = await Promise.all([
    prisma.program.findMany({
      where: programIds ? { id: { in: [...programIds] } } : {},
      orderBy: { name: "asc" },
    }),
    // `programIds` twice over on purpose: it narrows WHICH students the `where`
    // returns, and — here — which of each student's programs their hours and
    // their program cell are summed from.
    studentsWithHours(where, {
      slice: { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE },
      now,
      programIds,
      order: nameOrder,
    }),
    prisma.studentProfile.count({ where }),
  ]);

  return (
    <div className="space-y-4">
      <PageTitle
        title="Students"
        subtitle={
          administers
            ? undefined
            : "Everyone you hold time with, have met, or have work for."
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
        presets={
          // The chip is offered to a dual-role reader, who has both lists to
          // choose between. For somebody who only mentors it would be a filter
          // that never changes the answer.
          administers && isMentor
            ? [MINE_PRESET, ...STUDENT_PRESETS]
            : STUDENT_PRESETS
        }
        summary={filterSummary(total, { one: "student", many: "students" }, params)}
      />

      {total === 0 ? (
        // No title: the bar above has just said in words that nothing matches,
        // and saying it twice makes one fact read as two. What is left to add
        // is the way out.
        activeFilterCount(params) > 0 ? (
          <EmptyState variant="no-results">
            Check the spelling, or reset to see everyone.
          </EmptyState>
        ) : (
          <EmptyState title="No students yet">
            {administers
              ? "Staff register them; each then confirms their name on first sign-in."
              : "You hold time with nobody yet, and nobody's work is on your list."}
          </EmptyState>
        )
      ) : (
        <>
          <StudentsTable students={students} viewer={lens} sortable />
          <Pagination
            basePath="/students"
            params={params}
            page={page}
            total={total}
            unit="students"
          />
        </>
      )}
    </div>
  );
}
