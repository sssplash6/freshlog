import { notFound } from "next/navigation";

import { GrantsEditor, type GrantRow } from "@/components/forms/grants-editor";
import { PersonCell } from "@/components/person-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { FactList } from "@/components/ui/fact-list";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, Td, Tr, type Column } from "@/components/ui/table";
import { ALLOWED_MENTOR_DOMAIN } from "../../../../config/app-config";
import { ROLES } from "@/lib/constants";
import { requireUser } from "@/lib/dal";
import { emailConfigured } from "@/lib/email/send";
import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";

/**
 * Who administers what, and the handful of facts about this deployment.
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
export default async function PlatformPage() {
  const me = await requireUser();
  // Not a redirect: somebody who is not a platform admin has no business
  // knowing this address resolves.
  if (!me.platformAdmin) notFound();

  const [programs, people, lastDigest] = await Promise.all([
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
    prisma.user.aggregate({ _max: { digestSentAt: true } }),
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

  const columns: Column[] = [
    { label: "Person" },
    ...programs.map((p) => ({ label: p.name })),
    { label: "", align: "right" as const },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageTitle
        title="Platform"
        subtitle="Who administers which program, and how this deployment is set up."
      />

      <Section
        eyebrow={`${withAccess.length} of ${rows.length} have access`}
        title="Program access"
        caption="Program admins manage that program's students, mentors and time."
      >
        {rows.length === 0 ? (
          <EmptyState framed={false} title="Nobody to grant yet">
            Register a mentor or a staff account first.
          </EmptyState>
        ) : (
          <Table framed={false} columns={columns}>
            {rows.map((row) => (
              <Tr key={row.userId}>
                <Td>
                  <PersonCell
                    person={{ id: row.userId, name: row.name, email: row.email }}
                  >
                    {row.platformAdmin && (
                      <StatusChip severity="ok">Platform</StatusChip>
                    )}
                  </PersonCell>
                </Td>
                {programs.map((p) => (
                  <Td key={p.id} label={p.name}>
                    {row.platformAdmin ? (
                      // Not a grant, and shown differently on purpose: the
                      // platform flag covers programs that do not exist yet.
                      <span className="text-muted-fg">All</span>
                    ) : row.grants[p.id] ? (
                      <span className="text-ink">
                        {row.grants[p.id].charAt(0) +
                          row.grants[p.id].slice(1).toLowerCase()}
                      </span>
                    ) : (
                      <span className="text-muted-fg">—</span>
                    )}
                  </Td>
                ))}
                <Td align="right">
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

      <Section eyebrow="Read-only" title="Organisation">
        <div className="px-4 py-2 sm:px-5">
          <FactList
            items={[
              {
                label: "Mentor sign-up domain",
                value: `@${ALLOWED_MENTOR_DOMAIN}`,
              },
              {
                label: "Programs",
                value: `${programs.length} · ${programs.map((p) => p.name).join(", ")}`,
              },
              {
                label: "Email",
                value: emailConfigured()
                  ? "Live — messages are sent"
                  : "Dry run — nothing leaves the server",
              },
              {
                label: "Last weekly summary",
                value: lastDigest._max.digestSentAt
                  ? formatDate(lastDigest._max.digestSentAt)
                  : "Never sent",
              },
            ]}
          />
        </div>
      </Section>
    </div>
  );
}
