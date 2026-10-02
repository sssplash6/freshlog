import "server-only";

import { BUG_STATUS, type BugStatus, type TriageFilter } from "@/lib/bugs";
import { prisma } from "@/lib/prisma";
import type { User } from "@/generated/prisma/client";

/**
 * Every read of a bug report, and the only place that decides who sees what.
 *
 *   - A person reads their OWN reports in full.
 *   - Everybody reads the FIX LINE of a Fixed one — `resolution`,
 *     `resolvedAt`, `changelogDate`, and nothing else. A reporter's title and
 *     description can name a student, so `fixedBugs` does not select them.
 *   - A platform admin reads everything, with the reporter's name.
 *
 * `resolution` means two things: the public fix line when FIXED, and a note
 * private to the reporter and triagers when CLOSED. A report that was reopened
 * keeps its old line on the record, so it is masked unless the status says it
 * is current.
 */

const isResolved = (status: string) =>
  status === BUG_STATUS.FIXED || status === BUG_STATUS.CLOSED;

const reporterLabel = (
  reporter: { name: string | null; email: string } | null
): string => (reporter ? (reporter.name ?? reporter.email) : "Former user");

export async function myBugReports(userId: string) {
  const rows = await prisma.bugReport.findMany({
    where: { reporterId: userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      resolution: true,
      resolvedAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    resolution: isResolved(r.status) ? r.resolution : null,
  }));
}

export async function fixedBugs() {
  const rows = await prisma.bugReport.findMany({
    where: { status: BUG_STATUS.FIXED, resolution: { not: null } },
    orderBy: [{ resolvedAt: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: { resolution: true, resolvedAt: true, changelogDate: true },
  });
  return rows.map((r) => ({
    resolution: r.resolution!,
    resolvedAt: r.resolvedAt,
    changelogDate: r.changelogDate,
  }));
}

/**
 * One report for one viewer — or null. "Not yours" and "does not exist" are the
 * same answer, so an id cannot be probed for whether it is real.
 */
export async function bugReportFor(
  viewer: Pick<User, "id" | "platformAdmin">,
  id: string
) {
  const row = await prisma.bugReport.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      pagePath: true,
      reporterRole: true,
      reporterId: true,
      status: true,
      resolution: true,
      resolvedAt: true,
      changelogDate: true,
      createdAt: true,
      reporter: { select: { name: true, email: true } },
      image: { select: { id: true } },
    },
  });
  if (!row) return null;
  if (!viewer.platformAdmin && row.reporterId !== viewer.id) return null;

  const { reporter, image, reporterId, ...rest } = row;
  void reporterId;
  return {
    ...rest,
    resolution:
      viewer.platformAdmin || isResolved(row.status) ? row.resolution : null,
    hasImage: image !== null,
    reporterName: viewer.platformAdmin ? reporterLabel(reporter) : null,
  };
}

export async function triageList(
  viewer: Pick<User, "platformAdmin">,
  filter: TriageFilter
) {
  if (!viewer.platformAdmin) return [];

  const open: BugStatus[] = [BUG_STATUS.PENDING, BUG_STATUS.IN_PROGRESS];
  const where =
    filter === "all"
      ? {}
      : filter === "open"
        ? { status: { in: open } }
        : { status: filter };

  const rows = await prisma.bugReport.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      title: true,
      status: true,
      reporterRole: true,
      createdAt: true,
      reporter: { select: { name: true, email: true } },
    },
  });
  return rows.map(({ reporter, ...r }) => ({
    ...r,
    reporterName: reporterLabel(reporter),
  }));
}
