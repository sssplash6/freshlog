import { notFound } from "next/navigation";

import { GrantsEditor, type GrantRow } from "@/components/forms/grants-editor";
import { PersonCell } from "@/components/person-chip";
import { ProgramChip } from "@/components/program-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { Table, Td, Tr, type Column } from "@/components/ui/table";
import { ROLES } from "@/lib/constants";
import { requireUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Platform settings" };

/**
 * Who administers what.
 *
 * This page is the reason the grants model exists. Admins were a list in
 * `config/app-config.ts`, seeded on every boot — so there was no way to remove
 * one that survived the next deploy, and no way to give somebody a single
 * program at all. The owner asked for per-program admins; this is where they
 * are made.
 *
 * It is the ONLY write surface for a grant (§8.4). The program's own settings
 * page shows the same rows read-only with a link back here, and the seed is
 * down to the one bootstrap account, so there is exactly one answer to "how
 * did this person get access".
 */
/** "Admin" for "ADMIN" — a level as the editor names it. */
function levelName(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/**
 * The phone's line under a name: what the grid's columns say across a row,
 * as one sentence. Only the programs they hold — the "—" cells were the
 * length of the old layout and said nothing.
 */
function accessSummary(
  row: GrantRow,
  programs: { id: string; name: string }[]
): string {
  if (row.platformAdmin) return "Platform admin · all programs";
  const held = programs
    .filter((p) => row.grants[p.id])
    .map((p) => `${levelName(row.grants[p.id])}, ${p.name}`);
  return held.length > 0 ? held.join(" · ") : "No program access";
}

export default async function PlatformPage() {
  const me = await requireUser();
  // Not a redirect: somebody who is not a platform admin has no business
  // knowing this address resolves.
  if (!me.platformAdmin) notFound();

  const [programs, people] = await Promise.all([
    prisma.program.findMany({ orderBy: { name: "asc" } }),
    // Everyone who could plausibly be given access: staff, mentors, and
    // anybody already holding a grant. Students are not offered — a grant is
    // about administering the school, and the list is short enough to read.
    prisma.user.findMany({
      where: {
        OR: [
          { role: { not: ROLES.STUDENT } },
          { isMentor: true },
          { staffGrants: { some: {} } },
        ],
      },
      include: { staffGrants: { select: { programId: true, role: true } } },
      orderBy: [{ name: "asc" }, { email: "asc" }],
    }),
  ]);

  const rows: GrantRow[] = people.map((p) => ({
    userId: p.id,
    name: p.name,
    email: p.email,
    platformAdmin: p.platformAdmin,
    grants: Object.fromEntries(p.staffGrants.map((g) => [g.programId, g.role])),
  }));
  // Somebody with nothing is still listed, because giving them something is
  // exactly what this page is for.
  const withAccess = rows.filter(
    (r) => r.platformAdmin || Object.keys(r.grants).length > 0
  );

  // THREE columns, however many programs the school runs: who, what they hold,
  // the pencil. One column per program was seven at five programs, mostly "—",
  // and grew sideways with every program the school opened.
  const columns: Column[] = [
    { label: "Person" },
    { label: "Programs" },
    { label: "", align: "right" as const },
  ];

  return (
    // Full width: a table page.
    <div className="space-y-4">
      <PageTitle title="Platform" />

      <Section
        eyebrow={`${withAccess.length} of ${rows.length} have access`}
        title="Program access"
      >
        {rows.length === 0 ? (
          <EmptyState framed={false} title="No staff or mentors yet" />
        ) : (
          <Table framed={false} columns={columns}>
            {rows.map((row) => (
              // On a phone a person is ONE row — who, what they hold, the
              // pencil — instead of a card with a stacked line per program,
              // every one of them "—". With a dozen mentors that was a
              // 4,400px scroll to read what fits in a sentence each.
              <Tr
                key={row.userId}
                className="max-sm:flex max-sm:items-center max-sm:gap-2"
              >
                <Td className="max-sm:min-w-0 max-sm:flex-1">
                  <PersonCell
                    person={{ id: row.userId, name: row.name, email: row.email }}
                    secondary={
                      <>
                        <span className="sm:hidden">{accessSummary(row, programs)}</span>
                        <span className="max-sm:hidden">{row.email}</span>
                      </>
                    }
                  />
                </Td>
                <Td className="max-sm:hidden">
                  {row.platformAdmin ? (
                    // Not a grant, and shown differently on purpose: the
                    // platform flag covers programs that do not exist yet.
                    <span className="text-muted-fg">Platform admin · all programs</span>
                  ) : programs.some((p) => row.grants[p.id]) ? (
                    <span className="flex flex-col gap-y-1">
                      {programs
                        .filter((p) => row.grants[p.id])
                        .map((p) => (
                          <span key={p.id} className="flex min-w-0 items-center gap-2">
                            <ProgramChip program={p} />
                            <span className="shrink-0 text-xs text-muted-fg">
                              {levelName(row.grants[p.id])}
                            </span>
                          </span>
                        ))}
                    </span>
                  ) : (
                    <span className="text-muted-fg">—</span>
                  )}
                </Td>
                <Td align="right" className="max-sm:shrink-0">
                  <GrantsEditor
                    row={row}
                    programs={programs.map((p) => ({ id: p.id, name: p.name }))}
                  />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Section>

    </div>
  );
}
