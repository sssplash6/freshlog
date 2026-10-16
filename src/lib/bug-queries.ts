import "server-only";

import {
  BUG_STATUS,
  OPEN_BUG_STATUSES,
  isBugStatus,
  isClosingStatus,
  type TriageFilter,
} from "@/lib/bugs";
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

const isResolved = (status: string) => isBugStatus(status) && isClosingStatus(status);

const reporterLabel = (
  reporter: { name: string | null; email: string } | null,
  telegramAuthor: string | null
): string =>
  reporter ? (reporter.name ?? reporter.email) : (telegramAuthor ?? "Former user");

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
      kind: true,
      source: true,
      telegramAuthor: true,
      originalText: true,
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

  const { reporter, image, reporterId, telegramAuthor, originalText, ...rest } = row;
  void reporterId;
  return {
    ...rest,
    resolution:
      viewer.platformAdmin || isResolved(row.status) ? row.resolution : null,
    hasImage: image !== null,
    reporterName: viewer.platformAdmin ? reporterLabel(reporter, telegramAuthor) : null,
    // The sender's own words, beside the model's tidy description. Triagers
    // only: a group message can name anybody.
    originalText: viewer.platformAdmin ? originalText : null,
  };
}

/** How many Done and Won't do items the board shows under the columns. */
export const FINISHED_ON_BOARD = 30;

/**
 * The board: everything still open, and the most recently finished. Platform
 * admins only — anybody else gets two empty lists, whatever page asked.
 */
export async function triageList(
  viewer: Pick<User, "platformAdmin">,
  filter: TriageFilter
) {
  if (!viewer.platformAdmin) return { open: [], finished: [] };

  const kind = filter === "all" ? {} : { kind: filter };
  const select = {
    id: true,
    title: true,
    status: true,
    kind: true,
    source: true,
    reporterRole: true,
    telegramAuthor: true,
    createdAt: true,
    resolvedAt: true,
    reporter: { select: { name: true, email: true } },
  } as const;

  const [open, finished] = await Promise.all([
    prisma.bugReport.findMany({
      where: { ...kind, status: { in: OPEN_BUG_STATUSES } },
      orderBy: { createdAt: "desc" },
      take: 300,
      select,
    }),
    prisma.bugReport.findMany({
      where: { ...kind, status: { in: [BUG_STATUS.FIXED, BUG_STATUS.CLOSED] } },
      orderBy: [{ resolvedAt: "desc" }, { createdAt: "desc" }],
      take: FINISHED_ON_BOARD,
      select,
    }),
  ]);
  const label = ({ reporter, telegramAuthor, ...r }: (typeof open)[number]) => ({
    ...r,
    reporterName: reporterLabel(reporter, telegramAuthor),
  });
  return { open: open.map(label), finished: finished.map(label) };
}

export type TriageCard = Awaited<ReturnType<typeof triageList>>["open"][number];
