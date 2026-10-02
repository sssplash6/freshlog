import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle, Section } from "@/components/ui/section";
import { TabLinks } from "@/components/ui/segmented";
import { StatusChip } from "@/components/ui/status-chip";
import { triageList } from "@/lib/bug-queries";
import {
  BUG_STATUS_LABELS,
  BUG_STATUS_SEVERITY,
  isBugStatus,
  readTriageFilter,
} from "@/lib/bugs";
import { requirePlatformAdmin } from "@/lib/dal";
import { readParam, type SearchParams } from "@/lib/filters";
import { formatDate } from "@/lib/format";

/**
 * Every report, with who sent it. Platform admins only — the gate is the first
 * line, and `triageList` refuses anybody else too.
 */
export default async function TriagePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const viewer = await requirePlatformAdmin();
  const filter = readTriageFilter(readParam(await searchParams, "status"));
  const rows = await triageList(viewer, filter);

  return (
    <div className="space-y-4">
      <PageTitle
        backHref="/bugs"
        backLabel="Bug reports"
        title="Triage"
        subtitle="Every report, with who sent it."
      />

      <Section
        title="Reports"
        count={rows.length}
        action={
          <TabLinks
            label="Status"
            items={[
              { href: "/bugs/triage", label: "Open" },
              { href: "/bugs/triage?status=PENDING", label: "Pending" },
              { href: "/bugs/triage?status=IN_PROGRESS", label: "In progress" },
              { href: "/bugs/triage?status=FIXED", label: "Fixed" },
              { href: "/bugs/triage?status=CLOSED", label: "Closed" },
              { href: "/bugs/triage?status=all", label: "All" },
            ]}
          />
        }
      >
        {rows.length === 0 ? (
          <EmptyState framed={false} title="No reports here">
            Nothing matches this status.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <Link href={`/bugs/${r.id}`} className="font-medium text-ink hover:underline">
                    {r.title}
                  </Link>
                  <p className="text-[0.8125rem] text-muted-fg">
                    {r.reporterName} · {r.reporterRole.toLowerCase()} · {formatDate(r.createdAt)}
                  </p>
                </div>
                {isBugStatus(r.status) && (
                  <StatusChip severity={BUG_STATUS_SEVERITY[r.status]}>
                    {BUG_STATUS_LABELS[r.status]}
                  </StatusChip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
