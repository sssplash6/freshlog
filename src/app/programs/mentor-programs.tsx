import Link from "next/link";

import { ChevronRightIcon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { Figure } from "@/components/ui/figure";
import { ProgramChip } from "@/components/program-chip";
import { PageTitle } from "@/components/ui/section";
import { LinkRow } from "@/components/ui/link-row";
import { Table, Td, type Column } from "@/components/ui/table";
import { formatBalance, formatDuration } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { mentorCaseload } from "@/lib/queries";

/**
 * The same nouns as the admin's index, and none of the same figures.
 *
 * A program's own totals — everybody enrolled, everything still owed — are an
 * admin's business, and a mentor who saw them would be reading the ledger of
 * students they have never met. What a mentor cannot get anywhere else is the
 * shape of their OWN work across the places they do it: /mentor answers it one
 * program at a time behind a tab, and the number that matters most — how much
 * of their time is still unspent here — is spread down a caseload table.
 *
 * So: a row per program they work in, three figures, all three theirs.
 */
export type MentorProgramRow = {
  id: string;
  name: string;
  colorIndex: number;
  /** The cohort their pairing names, when it names one. */
  cohort: string | null;
  students: number;
  completed: number;
  remaining: number;
};

/**
 * The rows, as arithmetic and nothing else — which is why it is out here with
 * a test rather than inline in the component: the forfeiture rule below is the
 * kind of thing that is wrong quietly.
 */
export function mentorProgramRows(
  pairings: readonly {
    program: { id: string; name: string; colorIndex: number };
    cohort: { name: string } | null;
  }[],
  students: readonly {
    profile: { id: string };
    program: { id: string; name: string; colorIndex: number };
    completed: number;
    remaining: number;
    expired: boolean;
  }[]
): MentorProgramRow[] {
  type Acc = Omit<MentorProgramRow, "students"> & { students: Set<string> };
  const rows = new Map<string, Acc>();
  const at = (program: { id: string; name: string; colorIndex: number }, cohort: string | null) => {
    const held = rows.get(program.id);
    if (held) return held;
    const row: Acc = {
      id: program.id,
      name: program.name,
      colorIndex: program.colorIndex,
      cohort,
      students: new Set<string>(),
      completed: 0,
      remaining: 0,
    };
    rows.set(program.id, row);
    return row;
  };

  // The pairings first, so a program somebody was added to last week is on the
  // page before anybody has been allocated to them — a row of zeroes is the
  // honest answer to "where do I work", and an absence is not.
  for (const p of pairings) at(p.program, p.cohort?.name ?? null);

  for (const entry of students) {
    // A caseload can reach past the pairings: a grant, a task moved onto this
    // mentor, or a session already logged all put somebody on their list in a
    // program nobody paired them with. Those programs are places they work too.
    const row = at(entry.program, null);
    row.students.add(entry.profile.id);
    row.completed += entry.completed;
    // An expired allocation's unused minutes are forfeited, so only an
    // overdraw survives it — the same rule `allocationSummary` applies, and
    // counting the lost minutes as "remaining" would promise time that is gone.
    row.remaining += entry.expired
      ? Math.min(0, entry.remaining)
      : entry.remaining;
  }

  return [...rows.values()]
    .map((row) => ({ ...row, students: row.students.size }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function MentorPrograms({ mentorId }: { mentorId: string }) {
  const [pairings, caseload] = await Promise.all([
    prisma.mentorAssignment.findMany({
      where: { mentorId },
      include: { program: true, cohort: true, level: true },
      orderBy: [{ program: { name: "asc" } }],
    }),
    mentorCaseload(mentorId),
  ]);
  const shown = mentorProgramRows(pairings, caseload.students);

  const columns: Column[] = [
    { label: "Program" },
    { label: "Students", align: "right" },
    { label: "Completed", align: "right" },
    { label: "Remaining", align: "right", emphasis: "key" },
    { label: "", className: "w-14" },
  ];
  return (
    <div className="space-y-4">
      {/* No count in the h1. "Programs · 2" was the one page title in the app
          carrying one, over a table whose two rows say it anyway. */}
      <PageTitle title="Programs" />

      {shown.length === 0 ? (
        <EmptyState title="No programs yet" />
      ) : (
        <Table columns={columns} label="Programs">
          {shown.map((row) => (
            // The whole row opens, as on Home.
            <LinkRow key={row.id} href={`/sessions?program=${row.id}`}>
              <Td label="Program">
                {/* The way in is the mentor's own log, narrowed to this
                    program — the long form of the two figures on this row.
                    NOT `/programs/[id]`, which is the program's own ledger and
                    belongs to the people who administer it. */}
                <ProgramChip
                  program={row}
                  href={`/sessions?program=${row.id}`}
                  className="min-h-11 font-semibold sm:min-h-0"
                />
                {row.cohort && (
                  <span className="ml-2 text-xs text-muted-fg">{row.cohort}</span>
                )}
              </Td>
              <Td label="Students" align="right" className="tabular-nums">
                {row.students}
              </Td>
              {/* Exact, as on Home. These were rounded — "32+ hours" here
                  beside "36h 42m" there for the same mentor — and a mentor
                  spends against this balance, so the two read as two figures.
                  Plain: the balance beside it is the figure in orange. */}
              <Td label="Completed" align="right" className="tabular-nums">
                {formatDuration(row.completed)}
              </Td>
              <Td label="Remaining" align="right">
                <Figure
                  size="inline"
                  value={formatBalance(row.remaining)}
                  tone={row.remaining < 0 ? "danger" : "hours"}
                  className="sm:text-right"
                />
              </Td>
              <Td align="right" corner>
                <Link
                  href={`/sessions?program=${row.id}`}
                  aria-label={`Sessions in ${row.name}`}
                  className="-my-2 inline-flex h-8 w-8 items-center justify-center rounded-lg align-middle text-muted-fg transition-colors hover:text-brand"
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </Link>
              </Td>
            </LinkRow>
          ))}
        </Table>
      )}
    </div>
  );
}
