import { redirect } from "next/navigation";

import { CreateProgramForm } from "@/components/forms/program-forms";
import { EmptyState } from "@/components/ui/empty-state";
import { Figure } from "@/components/ui/figure";
import { ArrowLink } from "@/components/ui/link";
import { PageTitle } from "@/components/ui/section";
import { TabLinks } from "@/components/ui/segmented";
import { Table, Td, Tr, type Column } from "@/components/ui/table";
import { adminScope, scopeProgramFilter } from "@/lib/authz";
import { requireAdminAccess } from "@/lib/dal";
import { readParam, type SearchParams } from "@/lib/filters";
import { formatMoney, formatRough } from "@/lib/format";
import { programTotals } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { studentsWithHours } from "@/lib/queries";
import { actionableCount, type ViewerContext } from "@/lib/status";

import { PROGRAM_STATUS, programFlags, requestNow, studentsOf } from "./reads";

/**
 * Every program this reader administers, and which of them is asking for
 * something.
 *
 * There was no index before: the only way into a program was a row on the admin
 * dashboard, under a banner, a stat strip and an editable session log
 * (`admin/page.tsx:77-200`). What stood in for one on the two pages that had a
 * grid was `ProgramIslandCard` — a 3D-tilting card in the program's own hue,
 * carrying a monogram, a meter and three of its own stats. §6.11 keeps the
 * numbers and drops the furniture: a row per program, five figures, no hue.
 *
 * A ONE-PROGRAM ADMIN NEVER SEES THIS PAGE. Their whole scope is one entity, so
 * an index of one is a click that tells them what they already knew — the same
 * rule the sidebar follows when it collapses "Programs" to the program's own
 * name (`lib/nav.ts:98-110`).
 */
export default async function ProgramsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAdminAccess();
  const scope = await adminScope(user);
  if (scope !== "ALL" && scope.size === 1) {
    redirect(`/programs/${[...scope][0]}`);
  }

  const params = await searchParams;
  const archived = readParam(params, "status") === "archived";
  const programIds = scopeProgramFilter(scope);
  // `undefined` is a platform admin and means no filter at all — never "every
  // id I happen to have fetched", which goes stale the moment somebody opens a
  // new program.
  const inScope = programIds ? { in: [...programIds] } : undefined;
  const now = requestNow();
  const viewer: ViewerContext = { audience: "staff", userId: user.id, now };

  const [programs, students, pairings] = await Promise.all([
    // Both statuses in one read: the Archived tab has to carry its count before
    // anybody opens it, or a program that was archived by mistake is filed
    // behind a tab that looks empty.
    prisma.program.findMany({
      where: inScope ? { id: inScope } : {},
      orderBy: { name: "asc" },
    }),
    studentsWithHours(
      inScope ? { enrollments: { some: { programId: inScope } } } : {},
      { now, programIds }
    ),
    prisma.mentorAssignment.findMany({
      where: inScope ? { programId: inScope } : {},
      include: { mentor: true },
    }),
  ]);

  const active = programs.filter((p) => p.status !== PROGRAM_STATUS.ARCHIVED);
  const shown = archived
    ? programs.filter((p) => p.status === PROGRAM_STATUS.ARCHIVED)
    : active;

  const rows = shown.map((program) => {
    const enrolled = studentsOf(students, program.id);
    const theirs = pairings.filter((p) => p.programId === program.id);
    // §8.6: the one helper, over the unsliced roster. No second reducer and no
    // SQL `groupBy` — forfeiture is per allocation against its own use-by date,
    // which neither of those can see.
    const totals = programTotals(enrolled);
    return {
      id: program.id,
      name: program.name,
      tracksPayment: program.tracksPayment,
      students: totals.students,
      paid: totals.paid,
      mentors: new Set(theirs.map((p) => p.mentorId)).size,
      remaining: totals.remaining,
      attention: actionableCount(
        programFlags(program, enrolled, theirs, viewer)
      ),
    };
  });

  const columns: Column[] = [
    { label: "Program" },
    { label: "Students", align: "right" },
    { label: "Mentors", align: "right" },
    { label: "Remaining", align: "right" },
    { label: "Attention", align: "right" },
    {},
  ];

  return (
    <div className="space-y-5">
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

      {/* Under the title rather than in its actions row, matching `/mentors`: a
          control that pushes the page's own heading sideways when it opens is
          not an action. Platform admins only — a program is the unit access is
          granted in, and a new one arrives with nobody administering it (§8.3). */}
      {user.platformAdmin && <CreateProgramForm />}

      <TabLinks
        label="Programs"
        items={[
          { href: "/programs", label: "Active", count: active.length },
          {
            href: "/programs?status=archived",
            label: "Archived",
            count: programs.length - active.length,
          },
        ]}
      />

      {rows.length === 0 ? (
        archived ? (
          <EmptyState title="No archived programs">
            A program is archived from its settings once it has finished
            running.
          </EmptyState>
        ) : (
          <EmptyState title="No programs">
            {user.platformAdmin
              ? "Open one above, then grant the people who will run it access to it."
              : "Nobody has granted you a program to work in."}
          </EmptyState>
        )
      ) : (
        <Table columns={columns}>
          {rows.map((p) => (
            <Tr key={p.id}>
              <Td label="Program">
                <span className="font-medium text-ink">{p.name}</span>
                {p.tracksPayment && p.paid > 0 && (
                  <span className="block text-xs text-muted-fg">
                    {formatMoney(p.paid)} paid
                  </span>
                )}
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
              <Td label="Attention" align="right">
                {p.attention > 0 ? (
                  <span className="font-medium tabular-nums text-ink">
                    {p.attention}
                  </span>
                ) : (
                  <span className="text-muted-fg">—</span>
                )}
              </Td>
              <Td align="right">
                <ArrowLink href={`/programs/${p.id}`} className="text-[13px]">
                  Open
                </ArrowLink>
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </div>
  );
}
