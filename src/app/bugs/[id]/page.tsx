import { notFound } from "next/navigation";

import { BugTriageForm } from "@/components/forms/bug-triage-form";
import { Disclosure } from "@/components/ui/disclosure";
import { PageTitle, Section, READING_WIDTH } from "@/components/ui/section";
import { cn } from "@/lib/cn";
import { StatusChip } from "@/components/ui/status-chip";
import { bugReportFor } from "@/lib/bug-queries";
import {
  BUG_KIND,
  BUG_KIND_LABELS,
  BUG_SOURCE,
  BUG_STATUS,
  BUG_STATUS_LABELS,
  BUG_STATUS_SEVERITY,
  isBugKind,
  isBugStatus,
} from "@/lib/bugs";
import { requireUser } from "@/lib/dal";
import { readParam, type SearchParams } from "@/lib/filters";
import { formatDate } from "@/lib/format";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Bug report" };

/**
 * One report. The reporter and platform admins may read it; for anybody else it
 * does not exist. The row is fetched first and the viewer checked inside the
 * query, so "not yours" and "no such id" are the same 404.
 *
 * `?status=` is the board's status menu asking for Done or Won't do, which need
 * words before they can be saved; the triage form opens with it picked.
 */
export default async function BugPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const report = await bugReportFor(user, id);
  if (!report || !isBugStatus(report.status)) notFound();
  const asked = readParam(await searchParams, "status");
  const kind = isBugKind(report.kind) ? report.kind : BUG_KIND.BUG;

  return (
    <div className={cn(READING_WIDTH, "space-y-4")}>
      <PageTitle
        backHref={user.platformAdmin ? "/bugs/triage" : "/bugs"}
        backLabel={user.platformAdmin ? "Triage" : "Bug reports"}
        title={report.title}
        subtitle={
          <>
            {BUG_KIND_LABELS[kind]} · sent {formatDate(report.createdAt)}
            {report.reporterName && ` by ${report.reporterName}`}
            {report.source === BUG_SOURCE.TELEGRAM && " in the Telegram group"}
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
            <p className="px-4 py-3 text-body text-ink sm:px-5">{report.resolution}</p>
          </Section>
        )}

      <Section title={kind === BUG_KIND.FEATURE ? "What they asked for" : "What happened"}>
        <div className="space-y-3 px-4 py-3 sm:px-5">
          {/* Plain text children, and `whitespace-pre-wrap` so line breaks
              survive: nothing here is ever rendered as HTML. */}
          <p className="whitespace-pre-wrap text-body text-ink">{report.description}</p>
          {report.originalText && (
            <Disclosure label="Their own words" hint="As written in the group, with any voice note transcribed.">
              <p className="whitespace-pre-wrap pt-2 text-body text-muted-fg">{report.originalText}</p>
            </Disclosure>
          )}
          {report.pagePath && (
            <p className="text-xs text-muted-fg">
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
          {report.diagnostics && (
            <p className="text-xs text-muted-fg" title={report.userAgent ?? undefined}>
              {report.diagnostics}
            </p>
          )}
        </div>
      </Section>

      {user.platformAdmin && (
        <Section title="Triage">
          <BugTriageForm
            id={report.id}
            status={report.status}
            initialStatus={isBugStatus(asked) ? asked : report.status}
            kind={kind}
            resolution={report.resolution}
            changelogDate={report.changelogDate}
          />
        </Section>
      )}
    </div>
  );
}
