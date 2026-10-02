"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/lib/actions/shared";
import { sniffImageType } from "@/lib/avatar";
import {
  BUG_DESCRIPTION_MAX,
  BUG_REPORTS_PER_HOUR,
  BUG_RESOLUTION_MAX,
  BUG_SHOT_MAX_BYTES,
  BUG_SHOT_MIME_TYPES,
  BUG_STATUS,
  BUG_TITLE_MAX,
  isBugStatus,
  sanitizePagePath,
} from "@/lib/bugs";
import { isRealDay } from "@/lib/changelog";
import { NOTIFICATION_TYPES } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";
import { toDateInputValue } from "@/lib/format";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

const HOUR = 60 * 60 * 1000;

/**
 * Report a bug.
 *
 * Reachable directly, so everything is re-derived here: the lengths, the
 * screenshot's real format (never the upload's claimed type — these bytes are
 * served back to browsers), and the page, which is whatever a query string said.
 * A rejected screenshot saves nothing: a report that lost its picture silently
 * is worse than one that asks again.
 */
export async function reportBug(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const values = {
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
  };
  const title = values.title.trim();
  const description = values.description.trim();

  if (!title) {
    return { ok: false, field: "title", values, error: "Give the report a short title." };
  }
  if (title.length > BUG_TITLE_MAX) {
    return { ok: false, field: "title", values, error: `Keep the title under ${BUG_TITLE_MAX} characters.` };
  }
  if (!description) {
    return { ok: false, field: "description", values, error: "Say what went wrong." };
  }
  if (description.length > BUG_DESCRIPTION_MAX) {
    return { ok: false, field: "description", values, error: `Keep the description under ${BUG_DESCRIPTION_MAX} characters.` };
  }

  let screenshot: Prisma.BugReportImageCreateWithoutReportInput | null = null;
  const file = formData.get("screenshot");
  if (file instanceof File && file.size > 0) {
    if (file.size > BUG_SHOT_MAX_BYTES) {
      return { ok: false, values, error: `That screenshot is too large (${Math.round(BUG_SHOT_MAX_BYTES / 1024)}KB max).` };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = sniffImageType(bytes);
    if (!mimeType || !BUG_SHOT_MIME_TYPES.includes(mimeType as (typeof BUG_SHOT_MIME_TYPES)[number])) {
      return { ok: false, values, error: "That file isn't a PNG, JPEG, or WebP image." };
    }
    screenshot = { bytes, mimeType };
  }

  const pagePath = sanitizePagePath(formData.get("from"));
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
        title,
        description,
        pagePath,
        ...(screenshot ? { image: { create: screenshot } } : {}),
      },
      select: { id: true },
    });
  });

  if (!created) {
    return {
      ok: false,
      values,
      error: `You have sent ${BUG_REPORTS_PER_HOUR} reports in the last hour. Please try again a little later.`,
    };
  }

  const admins = await prisma.user.findMany({
    where: { platformAdmin: true },
    select: { id: true },
  });
  await notify(prisma, {
    to: admins.map((a) => a.id),
    type: NOTIFICATION_TYPES.BUG_REPORTED,
    message: `Bug report: ${title}`,
    href: `/bugs/${created.id}`,
    actorId: actor.id,
  });

  revalidatePath("/bugs", "layout");
  return {
    ok: true,
    message: "Thanks — we have it.",
    receipt: { id: created.id, headline: "Report sent.", notes: [] },
  };
}

/**
 * Triage: set a report's status, and say what happened.
 *
 * Platform admins only, and checked HERE — the page that renders the form
 * hides it from everybody else, but a server action is a public endpoint.
 *
 * Fixed and Closed both need words, because both end up in front of somebody:
 * the fix line is read by every user, the note by the person who reported it.
 * A report that was reopened keeps its old line on the record and loses its
 * dates, so it leaves the public list without anything being deleted.
 */
export async function setBugStatus(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };
  if (!actor.platformAdmin) {
    return { ok: false, error: "Only platform admins can change a report's status." };
  }

  const id = String(formData.get("id") ?? "");
  const status = formData.get("status");
  if (!isBugStatus(status)) return { ok: false, error: "Choose a status." };

  const resolution = String(formData.get("resolution") ?? "").trim();
  if (resolution.length > BUG_RESOLUTION_MAX) {
    return { ok: false, field: "resolution", error: `Keep it under ${BUG_RESOLUTION_MAX} characters.` };
  }

  const closing = status === BUG_STATUS.FIXED || status === BUG_STATUS.CLOSED;
  if (closing && !resolution) {
    return {
      ok: false,
      field: "resolution",
      error:
        status === BUG_STATUS.FIXED
          ? "Write the fix line everyone will read."
          : "Write a note to the person who reported it.",
    };
  }

  let changelogDate: string | null = null;
  if (status === BUG_STATUS.FIXED) {
    changelogDate = String(formData.get("changelogDate") ?? "").trim() || toDateInputValue(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(changelogDate) || !isRealDay(changelogDate)) {
      return { ok: false, field: "changelogDate", error: "Choose a real date." };
    }
  }

  const before = await prisma.bugReport.findUnique({
    where: { id },
    select: { status: true, title: true, reporterId: true },
  });
  if (!before) return { ok: false, error: "That report doesn't exist." };

  await prisma.bugReport.update({
    where: { id },
    data: {
      status,
      triagedById: actor.id,
      ...(closing
        ? { resolution, resolvedAt: new Date(), changelogDate }
        : { resolvedAt: null, changelogDate: null }),
    },
  });

  // On the way INTO Fixed or Closed only: rewording a fix line is not news.
  if (closing && before.status !== status && before.reporterId) {
    await notify(prisma, {
      to: [before.reporterId],
      type:
        status === BUG_STATUS.FIXED
          ? NOTIFICATION_TYPES.BUG_FIXED
          : NOTIFICATION_TYPES.BUG_CLOSED,
      message:
        status === BUG_STATUS.FIXED
          ? `Fixed: ${resolution}`
          : `Your report "${before.title}" was closed: ${resolution}`,
      href: `/bugs/${id}`,
      actorId: actor.id,
    });
  }

  revalidatePath("/bugs", "layout");
  return { ok: true, message: "Saved." };
}
