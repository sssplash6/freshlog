import { AddStudentsForm } from "@/components/forms/add-students-form";
import { StudentsTable } from "@/components/students-table";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { PAGE_SIZE, Pagination, parsePage } from "@/components/ui/pagination";
import { canActAsMentor } from "@/lib/constants";
import { requireProgramScope } from "@/lib/dal";
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
import { studentsWithHours } from "@/lib/queries";
import type { ViewerContext } from "@/lib/status";

import { programCohorts, programOf, requestNow } from "../../reads";

/**
 * The roster, with the program fixed.
 *
 * It is `/students` (§6.8) and not a second table: the page this replaces
 * reimplemented `ProgramStudentsIsland` line for line, with its own columns,
 * its own totals and no filters at all, so a program of two hundred students
 * was two hundred rows and no way to find one of them.
 *
 * The Program filter is the only thing hidden. Everything else — the search,
 * the presets, the paging — is the same bar over the same `where`, and the
 * program is a scope rather than a param: a `?program=` from somewhere else
 * ANDs against it and so can only narrow, never widen (`lib/filters.ts`, rule 3).
 *
 * This is where leaders and sales add students, so the fold sits above the list
 * — reading it is the common visit and adding to it the occasional one.
 */
export default async function ProgramStudentsPage({
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
  // One instant, shared with the layout above: the "expiring" chip and the
  // forfeiture in the row have to be judged against the same clock, or a
  // student can be in the filtered list and unexpired in their own row.
  const now = requestNow();
  const viewer: ViewerContext = { audience: "staff", userId: user.id, now };

  const [program, cohorts] = await Promise.all([
    programOf(id),
    programCohorts(id),
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

  const basePath = `/programs/${program.id}/students`;

  return (
    <div className="space-y-4">
      <Disclosure
        label="Add students"
        hint="Each confirms their own name and Telegram handle on first sign-in."
      >
        <AddStudentsForm
          program={{
            id: program.id,
            name: program.name,
            cohorts: cohorts.map((c) => ({ id: c.id, name: c.name })),
          }}
        />
      </Disclosure>

      <FilterBar
        basePath={basePath}
        params={query}
        q="students"
        selects={
          // Programs are flat by default, so the cohort control is offered only
          // where cohorts exist — and one cohort is not a choice.
          cohorts.length > 1
            ? [
                {
                  name: "cohort",
                  label: "Cohort",
                  all: "All cohorts",
                  options: cohorts.map((c) => ({ value: c.id, label: c.name })),
                },
              ]
            : []
        }
        presets={
          // The chip is offered to a reader who has both lists to choose
          // between; for somebody who cannot mentor it never changes the answer.
          canActAsMentor(user)
            ? [MINE_PRESET, ...STUDENT_PRESETS]
            : STUDENT_PRESETS
        }
        summary={filterSummary(total, { one: "student", many: "students" }, query)}
      />

      {total === 0 ? (
        activeFilterCount(query) > 0 ? (
          // The bar above has just said in words that nothing matched, so this
          // adds the way out and not the count again.
          <EmptyState variant="no-results">
            Check the spelling, or reset to see everyone.
          </EmptyState>
        ) : (
          <EmptyState title="Nobody enrolled">
            Add them above; each confirms their name on first sign-in.
          </EmptyState>
        )
      ) : (
        <>
          <StudentsTable students={students} viewer={viewer} showProgram={false} />
          <Pagination
            basePath={basePath}
            params={query}
            page={page}
            total={total}
            unit="students"
          />
        </>
      )}
    </div>
  );
}
