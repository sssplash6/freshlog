import "server-only";

import { sniffImageType } from "@/lib/avatar";
import {
  BUG_REPORTS_PER_HOUR,
  BUG_SHOT_MAX_BYTES,
  BUG_SHOT_MIME_TYPES,
  type BugDiagnostics,
} from "@/lib/bugs";
import { NOTIFICATION_TYPES } from "@/lib/constants";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import type { Prisma, User } from "@/generated/prisma/client";

/**
 * Filing a bug report, whichever way it arrives: the form at /bugs/new or a
 * picture drawn on the screen. One copy of the image check, the hourly cap and
 * the notice, so the two ways in cannot drift apart.
 *
 * Not a `"use server"` file on purpose. Every export of one becomes an endpoint
 * anybody can POST to, and `fileBugReport` trusts its caller to have checked
 * the actor and the text.
 */

const HOUR = 60 * 60 * 1000;

export const HOURLY_CAP_MESSAGE = `You have sent ${BUG_REPORTS_PER_HOUR} reports in the last hour. Please try again a little later.`;

/** Prisma's own shape, so the bytes type is the one a `Bytes` column takes. */
export type ReportImage = Prisma.BugReportImageCreateWithoutReportInput;

/**
 * The screenshot a request carried, by its real format — never the upload's
 * claimed type, because these bytes are served back to browsers. No file is not
 * an error here; whether a report needs one is the caller's rule.
 */
export async function readScreenshot(
  entry: FormDataEntryValue | null
): Promise<{ ok: true; image: ReportImage | null } | { ok: false; error: string }> {
  if (!(entry instanceof File) || entry.size === 0) return { ok: true, image: null };
  if (entry.size > BUG_SHOT_MAX_BYTES) {
    return { ok: false, error: `That screenshot is too large (${Math.round(BUG_SHOT_MAX_BYTES / 1024)}KB max).` };
  }
  const bytes = new Uint8Array(await entry.arrayBuffer());
  const mimeType = sniffImageType(bytes);
  if (!mimeType || !BUG_SHOT_MIME_TYPES.includes(mimeType as (typeof BUG_SHOT_MIME_TYPES)[number])) {
    return { ok: false, error: "That file isn't a PNG, JPEG, or WebP image." };
  }
  return { ok: true, image: { bytes, mimeType } };
}

/**
 * Write the report and tell every platform admin — or null, when this person
 * has already sent their hourly share.
 */
export async function fileBugReport(
  actor: Pick<User, "id" | "role">,
  report: {
    title: string;
    description: string;
    pagePath: string | null;
    image: ReportImage | null;
    diagnostics?: BugDiagnostics & { build: string | null };
  }
): Promise<{ id: string } | null> {
  const since = new Date(Date.now() - HOUR);

  // Counted and written in one transaction, so seven clicks at once cannot all
  // read "four so far".
  const created = await prisma.$transaction(async (tx) => {
    const recent = await tx.bugReport.count({
      where: { reporterId: actor.id, createdAt: { gte: since } },
    });
    if (recent >= BUG_REPORTS_PER_HOUR) return null;
    return tx.bugReport.create({
      data: {
        reporterId: actor.id,
        reporterRole: actor.role,
        title: report.title,
        description: report.description,
        pagePath: report.pagePath,
        ...(report.diagnostics ?? {}),
        ...(report.image ? { image: { create: report.image } } : {}),
      },
      select: { id: true },
    });
  });
  if (!created) return null;

  const admins = await prisma.user.findMany({
    where: { platformAdmin: true },
    select: { id: true },
  });
  await notify(prisma, {
    to: admins.map((a) => a.id),
    type: NOTIFICATION_TYPES.BUG_REPORTED,
    message: `Bug report: ${report.title}`,
    href: `/bugs/${created.id}`,
    actorId: actor.id,
  });

  return created;
}
