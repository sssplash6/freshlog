import { notFound } from "next/navigation";

import { BugTriageForm } from "@/components/forms/bug-triage-form";
import { PageTitle, Section } from "@/components/ui/section";
import { StatusChip } from "@/components/ui/status-chip";
import { bugReportFor } from "@/lib/bug-queries";
import {
  BUG_STATUS,
  BUG_STATUS_LABELS,
  BUG_STATUS_SEVERITY,
  isBugStatus,
} from "@/lib/bugs";
import { requireUser } from "@/lib/dal";
import { formatDate } from "@/lib/format";

/**
 * One report. The reporter and platform admins may read it; for anybody else it
 * does not exist. The row is fetched first and the viewer checked inside the
 * query, so "not yours" and "no such id" are the same 404.
 */
export default async function BugPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const report = await bugReportFor(user, id);
  if (!report || !isBugStatus(report.status)) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle
        backHref={user.platformAdmin ? "/bugs/triage" : "/bugs"}
        backLabel={user.platformAdmin ? "Triage" : "Bug reports"}
        title={report.title}
        subtitle={
          <>
            Sent {formatDate(report.createdAt)}
            {report.reporterName && ` by ${report.reporterName}`}
          </>
        }
        actions={
          <StatusChip severity={BUG_STATUS_SEVERITY[report.status]}>
            {BUG_STATUS_LABELS[report.status]}
          </StatusChip>
        }
      />

      {report.resolution &&
        (report.status === BUG_STATUS.FIXED || report.status === BUG_STATUS.CLOSED) && (
          <Section title={report.status === BUG_STATUS.FIXED ? "Fixed" : "From the team"}>
            <p className="px-4 py-3 text-[0.9375rem] text-ink sm:px-5">{report.resolution}</p>
          </Section>
        )}

      <Section title="What happened">
        <div className="space-y-3 px-4 py-3 sm:px-5">
          {/* Plain text children, and `whitespace-pre-wrap` so line breaks
              survive: nothing here is ever rendered as HTML. */}
          <p className="whitespace-pre-wrap text-[0.9375rem] text-ink">{report.description}</p>
          {report.pagePath && (
            <p className="text-[0.8125rem] text-muted-fg">
              On <span className="font-medium text-ink">{report.pagePath}</span>
            </p>
          )}
          {report.hasImage && (
            // eslint-disable-next-line @next/next/no-img-element -- a gated, private route; the image optimiser would fetch it without the session
            <img
              src={`/api/bug-report/${report.id}/image`}
              alt="Screenshot attached to this report"
              className="max-h-[32rem] max-w-full rounded-lg border border-line"
            />
          )}
        </div>
      </Section>

      {user.platformAdmin && (
        <Section title="Triage">
          <BugTriageForm
            id={report.id}
            status={report.status}
            resolution={report.resolution}
            changelogDate={report.changelogDate}
          />
        </Section>
      )}
    </div>
  );
}
