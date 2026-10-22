import Link from "next/link";

import { NewPartnerForm } from "@/components/forms/partner-settings-forms";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { FILL_CELL, Table, Td, Tr, type Column } from "@/components/ui/table";
import { requirePlatformAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Partners" };

/**
 * The partner schools whose students rate our mentors and sessions, and the
 * form that adds another.
 *
 * Two queries whatever the count: the partners with their list and feedback
 * counts, and every partner's average in one grouped read. A partner whose
 * form is off is listed too — an admin has to reach it to switch it back on.
 */
export default async function PartnersPage() {
  await requirePlatformAdmin();

  const [partners, averages] = await Promise.all([
    prisma.feedbackPartner.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        active: true,
        _count: { select: { students: true, feedback: true } },
      },
    }),
    prisma.partnerFeedback.groupBy({
      by: ["partnerId"],
      _avg: { rating: true },
    }),
  ]);
  const average = new Map(averages.map((a) => [a.partnerId, a._avg.rating]));

  const columns: Column[] = [
    { label: "Partner" },
    { label: "Link" },
    { label: "Form" },
    { label: "Emails", align: "right" },
    { label: "Feedback", align: "right" },
    { label: "Average", align: "right", emphasis: "key" },
  ];

  return (
    <div className="space-y-4">
      <PageTitle
        title="Partners"
        subtitle="Schools whose students rate our mentors and sessions by link."
      />

      {partners.length === 0 ? (
        <EmptyState title="No partners yet">
          Add one to get a feedback link.
        </EmptyState>
      ) : (
        <Section title="Partners" count={partners.length}>
          <Table columns={columns} framed={false} label="Partners">
            {partners.map((p) => {
              const avg = average.get(p.id) ?? null;
              return (
                <Tr key={p.id}>
                  <Td label="Partner" className={FILL_CELL}>
                    <Link
                      href={`/partners/${p.slug}`}
                      className="font-semibold text-ink hover:text-brand"
                    >
                      {p.name}
                    </Link>
                  </Td>
                  <Td label="Link" tone="muted" className="whitespace-nowrap">
                    /f/{p.slug}
                  </Td>
                  <Td label="Form">
                    {/* An open form is "nothing wrong", the ✓ in ink; one
                        switched off is a choice an admin made, so grey rather
                        than a warning. */}
                    {p.active ? (
                      <StatusChip severity="ok">Active</StatusChip>
                    ) : (
                      <StatusChip severity="neutral">Off</StatusChip>
                    )}
                  </Td>
                  <Td label="Emails" align="right" tone="muted">
                    {p._count.students}
                  </Td>
                  <Td label="Feedback" align="right" tone="muted">
                    {p._count.feedback}
                  </Td>
                  <Td label="Average" align="right" tone="key">
                    {avg === null ? "—" : avg.toFixed(1)}
                  </Td>
                </Tr>
              );
            })}
          </Table>
        </Section>
      )}

      <Section title="New partner">
        <NewPartnerForm />
      </Section>
    </div>
  );
}
