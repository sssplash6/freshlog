import { redirect } from "next/navigation";

import { CreateProgramForm } from "@/components/forms/program-forms";
import { CreateButton, CreatePanel, CreateSlot } from "@/components/page-create";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Figure } from "@/components/ui/figure";
import { HoursBar } from "@/components/ui/hours-left";
import { ProgramChip } from "@/components/program-chip";
import { PageTitle } from "@/components/ui/section";
import { TabLinks } from "@/components/ui/segmented";
import { FILL_CELL, Table, Td, Tr, type Column } from "@/components/ui/table";
import { adminScope, scopeIsEmpty, scopeProgramFilter } from "@/lib/authz";
import { canActAsMentor } from "@/lib/constants";
import { requireAdminAccess, requireUser } from "@/lib/dal";
import { profileOf } from "@/lib/profile";
import { readParam, type SearchParams } from "@/lib/filters";
import { formatRough } from "@/lib/format";
import { programTotals } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { studentsWithHours } from "@/lib/queries";

import { MentorPrograms } from "./mentor-programs";
import { PROGRAM_STATUS, requestNow, studentsOf } from "./reads";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Programs" };

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
 *
 * A MENTOR SEES A DIFFERENT PAGE AT THE SAME ADDRESS (`mentor-programs.tsx`).
 * The nouns are the same and none of the figures are: a program's roster and
 * what it still owes belong to the people who administer it, and what a mentor
 * has no other page for is their own work across the places they do it. The
 * lens decides, exactly as the nav does — so an admin who mentors reads their
 * own footprint in the mentor lens and the school's ledger in the admin one,
 * and neither view can show them anything the other would not let them reach.
 */
export default async function ProgramsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const viewer = await requireUser();
  const lens = await profileOf(viewer);
  const reach = await adminScope(viewer);
  if (canActAsMentor(viewer) && (lens === "mentor" || scopeIsEmpty(reach))) {
    return <MentorPrograms mentorId={viewer.id} />;
  }

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

  const [programs, students, pairings] = await Promise.all([
    // Both statuses in one read: the Archived tab has to carry its count before
    // anybody opens it, or a program that was archived by mistake is filed
    // behind a tab that looks empty.
    prisma.program.findMany({
      where: inScope ? { id: inScope } : {},
      orderBy: { name: "asc" },
      include: { _count: { select: { levels: true } } },
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

  // By name as people read it, not by code point ("efde" after "Research").
  programs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

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
      colorIndex: program.colorIndex,
      // Research is one row here and three places inside: the count says
      // there is more behind the name than one roster.
      levels: program._count.levels,
      students: totals.students,
      mentors: new Set(theirs.map((p) => p.mentorId)).size,
      remaining: totals.remaining,
      forfeited: totals.forfeited,
      // For the usage bar: what was delivered or charged, of what was granted.
      used: totals.completed + totals.missed,
      allotted: totals.allotted,
    };
  });

  const columns: Column[] = [
    { label: "Program" },
    { label: "Students", align: "right" },
    { label: "Mentors", align: "right" },
    // A bar of where the granted time went: two numbers across 1,100px said
    // nothing about which program is running hot (October 2026 audit).
    { label: "Time used", className: "w-52 max-lg:hidden" },
    { label: "Remaining", align: "right", emphasis: "key" },
    // Minutes lost to passed deadlines — the figure that makes the ledger
    // honest, and the one a Remaining of zero used to hide entirely.
    { label: "Expired unused", align: "right" },
  ];

  return (
    <CreateSlot>
    <div className="space-y-4">
      {/* No count in the title: the Active and Archived tabs under it carry
          one each, and "Programs · 5" over "Active 5" was the same fact twice.
          Creating is the title's one action, the same button in the same
          place as every other page's "new" (page-create.tsx). Platform admins
          only — a program is the unit access is granted in, and a new one
          arrives with nobody administering it (§8.3). */}
      <PageTitle
        title="Programs"
        actions={user.platformAdmin ? <CreateButton label="New program" /> : undefined}
      />

      {user.platformAdmin && (
        <CreatePanel
          title="New program"
          hint="It starts with no students or mentors. Grant its admins access afterwards."
        >
          <CreateProgramForm />
        </CreatePanel>
      )}

      {/* Arrived from Students' "Add students": adding happens on a program (that
          is where the cohort is chosen), and the button used to drop the reader
          on this list with no word on why. */}
      {readParam(params, "for") === "students" && (
        <Callout tone="info" row title="Choose a program to add students to.">
          Open it, then press Add students.
        </Callout>
      )}

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
              ? "Create one with New program, then grant the people who run it access."
              : "Nobody has granted you a program to work in."}
          </EmptyState>
        )
      ) : (
        <Table columns={columns} label="Programs">
          {rows.map((p) => (
            <Tr key={p.id}>
              <Td className={FILL_CELL}>
                {/* The NAME is the way in, the rule `PersonCell` already
                    follows on every roster in the app: an "Open" link at the
                    far right of the row made the reader cross four columns of
                    figures to reach the thing they had already found, and left
                    the program itself looking like inert text. `min-h-11` only
                    while stacked — on a phone this anchor is the row's one
                    target, and a table row does not need the height. */}
                {/* One line on a phone — the name and what is left in it —
                    with the counts quiet underneath, instead of five stacked
                    labelled lines per program. */}
                <span className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <ProgramChip
                      program={p}
                      href={`/programs/${p.id}`}
                      className="min-h-11 font-semibold sm:min-h-0"
                    />
                    {p.levels > 0 && (
                      <span className="shrink-0 text-xs text-muted-fg max-sm:hidden">
                        {p.levels} {p.levels === 1 ? "level" : "levels"}
                      </span>
                    )}
                  </span>
                  <Figure
                    size="inline"
                    value={formatRough(p.remaining)}
                    tone={p.remaining < 0 ? "danger" : "hours"}
                    className="shrink-0 sm:hidden"
                  />
                </span>
                <span className="-mt-2 block pb-1 text-xs text-muted-fg sm:hidden">
                  {p.students} {p.students === 1 ? "student" : "students"} · {p.mentors}{" "}
                  {p.mentors === 1 ? "mentor" : "mentors"}
                  {p.levels > 0 && ` · ${p.levels} ${p.levels === 1 ? "level" : "levels"}`}
                  {p.forfeited > 0 && ` · ${formatRough(p.forfeited)} expired unused`}
                </span>
              </Td>
              <Td align="right" className="tabular-nums max-sm:hidden">
                {p.students}
              </Td>
              <Td align="right" className="tabular-nums max-sm:hidden">
                {p.mentors}
              </Td>
              <Td className="max-lg:hidden max-sm:hidden">
                {p.allotted > 0 ? (
                  <span className="flex items-center gap-3">
                    <HoursBar
                      remaining={p.remaining}
                      used={p.used}
                      expired={p.forfeited}
                      className="w-full min-w-24 max-w-40 flex-1"
                    />
                    <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-fg">
                      {(() => {
                        const pct = Math.round(((p.used + p.forfeited) / p.allotted) * 100);
                        return pct > 100 ? "100%+" : `${pct}%`;
                      })()}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-fg">—</span>
                )}
              </Td>
              <Td align="right" className="max-sm:hidden">
                <Figure
                  size="inline"
                  value={formatRough(p.remaining)}
                  tone={p.remaining < 0 ? "danger" : "hours"}
                  className="sm:text-right"
                />
              </Td>
              <Td align="right" className="tabular-nums max-sm:hidden">
                {/* Plain ink: the heading already says these hours were lost,
                    and amber with no word or glyph beside it was colour doing
                    the talking alone. */}
                {p.forfeited > 0 ? (
                  formatRough(p.forfeited)
                ) : (
                  <span className="text-muted-fg">—</span>
                )}
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </div>
    </CreateSlot>
  );
}
