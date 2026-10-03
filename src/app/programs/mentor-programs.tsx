import { EmptyState } from "@/components/ui/empty-state";
import { Figure } from "@/components/ui/figure";
import { ProgramChip } from "@/components/program-chip";
import { PageTitle } from "@/components/ui/section";
import { Table, Td, Tr, type Column } from "@/components/ui/table";
import { formatRough } from "@/lib/format";
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
    program: { id: string; name: string };
    cohort: { name: string } | null;
  }[],
  students: readonly {
    profile: { id: string };
    program: { id: string; name: string };
    completed: number;
    remaining: number;
    expired: boolean;
  }[]
): MentorProgramRow[] {
  type Acc = Omit<MentorProgramRow, "students"> & { students: Set<string> };
  const rows = new Map<string, Acc>();
  const at = (program: { id: string; name: string }, cohort: string | null) => {
    const held = rows.get(program.id);
    if (held) return held;
    const row: Acc = {
      id: program.id,
      name: program.name,
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
    { label: "Remaining", align: "right" },
  ];
  return (
    <div className="space-y-4">
      <PageTitle
        title={
          <>
            Programs{" "}
            <span className="font-semibold tabular-nums text-muted-fg">
              · {shown.length}
            </span>
          </>
        }
      />

      {shown.length === 0 ? (
        <EmptyState title="No programs yet">
          An admin has to add you to a program before you can log anything.
        </EmptyState>
      ) : (
        <Table columns={columns}>
          {shown.map((row) => (
            <Tr key={row.id}>
              <Td label="Program">
                {/* The way in is the mentor's own log, narrowed to this
                    program — the long form of the two figures on this row.
                    NOT `/programs/[id]`, which is the program's own ledger and
                    belongs to the people who administer it. */}
                <ProgramChip
                  program={{ id: row.id, name: row.name }}
                  href={`/sessions?program=${row.id}`}
                  className="min-h-11 font-medium sm:min-h-0"
                />
                {row.cohort && (
                  <span className="ml-2 text-[0.8125rem] text-muted-fg">{row.cohort}</span>
                )}
              </Td>
              <Td label="Students" align="right" className="tabular-nums">
                {row.students}
              </Td>
              <Td label="Completed" align="right">
                <Figure
                  size="inline"
                  value={formatRough(row.completed)}
                  tone="hours"
                  className="sm:text-right"
                />
              </Td>
              <Td label="Remaining" align="right">
                <Figure
                  size="inline"
                  value={formatRough(row.remaining)}
                  tone={row.remaining < 0 ? "danger" : "hours"}
                  className="sm:text-right"
                />
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </div>
  );
}
