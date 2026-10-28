import "server-only";

import type { ApiBug, ApiBugs, ApiTriage, BugRow, BugStatus } from "@/lib/api/v1/types";
import { bugReportFor, fixedBugs, myBugReports, triageList } from "@/lib/bug-queries";
import { BUG_KIND_LABELS, BUG_SOURCE, BUG_STATUS_LABELS, OPEN_BUG_STATUSES, isBugKind, isBugStatus, type TriageFilter } from "@/lib/bugs";
import { programToday } from "@/lib/when";
import type { User } from "@/generated/prisma/client";

/** The Tashkent day an instant fell on, as the API writes days. */
const dayOf = programToday;

/** A status freshform doesn't know reads as New, which is what a fresh row holds. */
const statusOf = (raw: string): BugStatus => (isBugStatus(raw) ? raw : "PENDING");

function rowOf(r: { id: string; title: string; status: string; createdAt: Date }): BugRow {
  const status = statusOf(r.status);
  return {
    id: r.id,
    title: r.title,
    status,
    statusLabel: BUG_STATUS_LABELS[status],
    open: OPEN_BUG_STATUSES.includes(status),
    sentOn: dayOf(r.createdAt),
  };
}

/**
 * The two lists of /bugs, with the readers' rights `bug-queries.ts` decides:
 * your own reports in full, and everybody's fix lines, which carry nothing a
 * reporter wrote.
 */
export async function bugsFor(user: Pick<User, "id">): Promise<ApiBugs> {
  const [mine, fixed] = await Promise.all([myBugReports(user.id), fixedBugs()]);
  return {
    mine: mine.map(rowOf),
    fixed: fixed.map((f) => ({ fix: f.resolution, fixedOn: f.resolvedAt ? dayOf(f.resolvedAt) : null })),
  };
}

/**
 * One report for its reporter or a platform admin, or null for anybody else and
 * for no such report alike (`bugReportFor`). What the triage page adds (who
 * sent it, the group's own words, where it was drawn) goes to a platform admin
 * only, in `triage`: `bugReportFor` selects it for nobody else.
 */
export async function bugFor(user: Pick<User, "id" | "platformAdmin">, id: string): Promise<ApiBug | null> {
  const report = await bugReportFor(user, id);
  if (!report) return null;
  return {
    ...rowOf(report),
    description: report.description,
    resolution: report.resolution,
    imagePath: report.hasImage ? `/api/v1/bugs/${report.id}/image` : null,
    triage: user.platformAdmin
      ? {
          reporter: report.reporterName ?? "Former user",
          kind: isBugKind(report.kind) ? report.kind : "BUG",
          fromTelegram: report.source === BUG_SOURCE.TELEGRAM,
          originalText: report.originalText,
          pagePath: report.pagePath,
          diagnostics: report.diagnostics,
          changelogDate: report.changelogDate,
        }
      : null,
  };
}

/** The triage board as /bugs/triage reads it (`triageList`): platform admins only, and null for anybody else. */
export async function triageFor(user: Pick<User, "platformAdmin">, filter: TriageFilter): Promise<ApiTriage | null> {
  if (!user.platformAdmin) return null;
  const { open, finished } = await triageList(user, filter);
  const card = (r: (typeof open)[number]) => {
    const status = statusOf(r.status);
    const kind = isBugKind(r.kind) ? r.kind : "BUG";
    return {
      id: r.id,
      title: r.title,
      status,
      statusLabel: BUG_STATUS_LABELS[status],
      kind,
      kindLabel: BUG_KIND_LABELS[kind],
      fromTelegram: r.source === BUG_SOURCE.TELEGRAM,
      reporter: r.reporterName,
      sentOn: dayOf(r.createdAt),
      resolvedOn: r.resolvedAt ? dayOf(r.resolvedAt) : null,
    };
  };
  return { open: open.map(card), finished: finished.map(card) };
}
