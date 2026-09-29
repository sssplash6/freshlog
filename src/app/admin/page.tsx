import { Suspense } from "react";

import { CheckIcon } from "@/components/icons";
import { Figure } from "@/components/ui/figure";
import { ArrowLink } from "@/components/ui/link";
import { CreateProgramForm } from "@/components/forms/program-forms";
import { ProgramChip } from "@/components/program-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { Table, Td, Tr, type Column } from "@/components/ui/table";
import {
  adminScope,
  scopeIsEmpty,
  scopeProgramFilter,
} from "@/lib/authz";
import { staffAttention, type StaffPreload } from "@/lib/attention";
import { requireStaff } from "@/lib/dal";
import { formatRough } from "@/lib/format";
import { programTotals } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { studentsWithHours } from "@/lib/queries";
import { actionableCount, status, type ViewerContext } from "@/lib/status";
import { PROGRAM_ZONE, programWallClock } from "@/lib/when";
import type { User } from "@/generated/prisma/client";

/**
 * The admin's landing page: how big are my programs, and how much time is
 * still in them.
 *
 * It used to open with "Needs you" — twenty derived rows about students,
 * mentors, tasks and meetings — and then a week's diary, and then this table.
 * Both of those are behind the bell now (`lib/attention.ts`, `/notifications`),
 * which is the one place in the app that lists "what is waiting on me"; this
 * page says only how many, and links there. What is left here is the thing no
 * feed can say: the shape of the school this person administers.
 *
 * Every figure comes from `programTotals` over the unsliced roster, per
 * program, so a student in two programs is counted once in each with that
 * program's own hours.
 */

/**
 * "14:32", on the program's clock. §5.8 lets exactly this page claim
 * freshness: its figures are a snapshot of a ledger other people are writing
 * to, and a table that was right at nine is worth knowing is from nine.
 */
function clock(now: Date) {
  const wall = programWallClock(now);
  const hh = String(wall.getUTCHours()).padStart(2, "0");
  const mm = String(wall.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * How many things are waiting on this reader, and the way to them.
 *
 * A count and a link, not the rows: the rows live behind the bell, and a
 * second inbox on this page is what the bell replaced. But a home page that
 * cannot say whether anything is waiting sends every reader to the bell to
 * find out, which is the question a home page is for. Streamed, so the
 * program table never waits on the mentors, tasks and ratings the count also
 * reads — the roster it already has is handed over rather than read twice.
 */
async function NeedsYou({ user, preload }: { user: User; preload: StaffPreload }) {
  const { statuses } = await staffAttention(user, preload);
  const n = actionableCount(statuses);

  if (n === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-surface px-4 py-3 text-[0.9375rem] text-muted-fg shadow-sm sm:px-5">
        <CheckIcon className="h-4 w-4 shrink-0 text-ink/60" />
        Nothing needs you right now.
      </p>
    );
  }
  return (
    // One row in a card of its own — the grouped-list shape for a single
    // fact with a way through it.
    <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-surface px-4 py-3 text-[0.9375rem] text-ink shadow-sm sm:px-5">
      <span>
        <span className="font-semibold tabular-nums">{n}</span>{" "}
        {n === 1 ? "thing needs" : "things need"} you
      </span>
      <ArrowLink href="/notifications">See what</ArrowLink>
    </p>
  );
}

export default async function AdminHomePage() {
  const user = await requireStaff();

  // The reader's grants are applied ONCE here and every read below carries
  // them. `undefined` is a platform admin and means no filter at all — not
  // "every id I happen to have fetched", which would go stale the moment a
  // program is created.
  const scope = await adminScope(user);
  const programIds = scopeProgramFilter(scope);
  const inScope = programIds ? { in: [...programIds] } : undefined;

  // One instant for the whole render, so no two figures can disagree about
  // what today is or what has expired.
  const now = new Date();
  const viewer: ViewerContext = { audience: "staff", userId: user.id, now };

  // Staff with no grants are let in by `requireStaff` precisely so this page
  // can answer them — "0 programs · 0 students" is a dashboard, not the
  // explanation, and `STAFF_UNSCOPED` already has the honest one. A platform
  // admin holding no programs is a different case entirely: theirs is the
  // empty school the CreateProgramForm below belongs to.
  if (scopeIsEmpty(scope) && !user.platformAdmin) {
    const unscoped = status("STAFF_UNSCOPED", viewer);
    return (
      <div className="space-y-4">
        <PageTitle title="Home" />
        <EmptyState variant="blocked" title={unscoped?.label ?? "No programs granted"}>
          {unscoped?.explanation ??
            "A platform admin grants you a program to work in."}
        </EmptyState>
      </div>
    );
  }

  const [programs, students, pairings] = await Promise.all([
    prisma.program.findMany({
      where: inScope ? { id: inScope } : {},
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    studentsWithHours(
      inScope ? { enrollments: { some: { programId: inScope } } } : {},
      { now, programIds }
    ),
    prisma.mentorAssignment.findMany({
      where: inScope ? { programId: inScope } : {},
      select: { mentorId: true, programId: true },
    }),
  ]);

  const overall = programTotals(students);
  const rows = programs.map((p) => {
    // That program's figures for each student in it — never the student's
    // combined row, which would put another program's hours in this total and
    // count a two-program student twice.
    const enrolled = students.flatMap((s) => {
      const figures = s.byProgram.get(p.id);
      return figures ? [figures] : [];
    });
    const totals = programTotals(enrolled);
    return {
      ...p,
      students: totals.students,
      mentors: new Set(
        pairings.filter((a) => a.programId === p.id).map((a) => a.mentorId)
      ).size,
      remaining: totals.remaining,
    };
  });

  const columns: Column[] = [
    { label: "Program" },
    { label: "Students", align: "right" },
    { label: "Mentors", align: "right" },
    { label: "Remaining", align: "right" },
  ];

  return (
    <div className="space-y-4">
      <PageTitle
        title="Home"
        actions={
          <span className="text-[0.8125rem] text-muted-fg">
            Updated {clock(now)}{" "}
            <span className="sr-only">{PROGRAM_ZONE} time</span>
          </span>
        }
      />

      {/* The school in three figures, as a stat row: label over value, space
          between, no boxes. It was a sentence under the title with one bold
          number in it, which made the reader parse prose to find a figure.
          Remaining leads, in the hours orange, because it is the one of the
          three anybody acts on. */}
      <dl className="flex flex-wrap gap-x-10 gap-y-3 px-1">
        <div>
          <dt className="text-[0.8125rem] text-muted-fg">Programs</dt>
          <dd className="mt-0.5 text-[1.5rem] font-semibold tabular-nums text-ink">
            {programs.length}
          </dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-muted-fg">Students</dt>
          <dd className="mt-0.5 text-[1.5rem] font-semibold tabular-nums text-ink">
            {overall.students}
          </dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-muted-fg">Remaining</dt>
          <dd
            className={
              overall.remaining < 0
                ? "mt-0.5 text-[1.5rem] font-semibold tabular-nums text-danger-ink"
                : "mt-0.5 text-[1.5rem] font-semibold tabular-nums text-accent-ink"
            }
          >
            {formatRough(overall.remaining)}
          </dd>
        </div>
      </dl>

      <Suspense fallback={null}>
        <NeedsYou user={user} preload={{ now, programs, students }} />
      </Suspense>

      {user.platformAdmin && <CreateProgramForm />}

      {/* One program is the whole scope, and a table of one row that repeats
          the figures above it is furniture. */}
      {programs.length > 1 && (
        <Section title="Programs">
          <Table columns={columns} framed={false}>
            {rows.map((p) => (
              <Tr key={p.id}>
                <Td label="Program">
                  {/* The name is the way in — the same rule as `/programs`,
                      which this table is the short version of. */}
                  <ProgramChip
                    program={p}
                    href={`/programs/${p.id}`}
                    className="min-h-11 font-medium sm:min-h-0"
                  />
                </Td>
                <Td label="Students" align="right" className="tabular-nums">
                  {p.students}
                </Td>
                <Td label="Mentors" align="right" className="tabular-nums">
                  {p.mentors}
                </Td>
                <Td label="Remaining" align="right">
                  <Figure
                    size="inline"
                    value={formatRough(p.remaining)}
                    tone={p.remaining < 0 ? "danger" : "hours"}
                    className="sm:text-right"
                  />
                </Td>
              </Tr>
            ))}
          </Table>
        </Section>
      )}
    </div>
  );
}
