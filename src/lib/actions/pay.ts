"use server";

import { revalidatePath } from "next/cache";

import { assertPlatformAdmin } from "@/lib/authz";
import { canActAsMentor } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";
import { formatFullDate, toDateInputValue } from "@/lib/format";
import { formatRate, parseDollarsPerHour, rateDayBounds } from "@/lib/pay";
import { prisma } from "@/lib/prisma";
import { parseDateField, type ActionState } from "@/lib/actions/shared";

/**
 * Setting what a mentor is paid per logged hour.
 *
 * Platform admins only, like a program grant: pay is confidential, and the
 * person who sets it must be somebody whose reach is already total. Mentors
 * cannot change their own rate here or anywhere; FreshWeek's department lead
 * is who they ask.
 *
 * Append-only. Every save is a NEW row from a day; nothing is edited or
 * deleted, so the history a payroll was worked out from never moves under it.
 * A typo is corrected by saving again with the same day — the newer row wins
 * (`rateOn` in lib/pay.ts).
 *
 * The earliest day a rate may start is the first of the current month in
 * Tashkent. Earlier months have very likely been filed and paid in FreshWeek;
 * re-pricing them from here would quietly change figures somebody has already
 * been paid on. A correction that far back is a conversation, not a form.
 */

/** Add a rate for one mentor, from one day. */
export async function setMentorRate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await getCurrentUser();
  const denied = assertPlatformAdmin(actor);
  if (denied) return denied;

  const values = {
    mentorId: String(formData.get("mentorId") ?? ""),
    dollarsPerHour: String(formData.get("dollarsPerHour") ?? ""),
    effectiveFrom: String(formData.get("effectiveFrom") ?? ""),
  };

  const mentor = values.mentorId
    ? await prisma.user.findUnique({
        where: { id: values.mentorId },
        select: { id: true, name: true, email: true, role: true, isMentor: true },
      })
    : null;
  if (!mentor || !canActAsMentor(mentor)) {
    return { ok: false, error: "Pick a mentor.", field: "mentorId", values };
  }

  const rate = parseDollarsPerHour(values.dollarsPerHour);
  if ("error" in rate) return { ok: false, error: rate.error, field: "dollarsPerHour", values };

  const from = parseDateField(values.effectiveFrom);
  if ("error" in from) return { ok: false, error: from.error, field: "effectiveFrom", values };
  const { min, max } = rateDayBounds();
  const day = toDateInputValue(from.value);
  if (day < min) {
    return {
      ok: false,
      error: `A rate can start no earlier than ${formatFullDate(new Date(`${min}T00:00:00.000Z`))}: earlier months may already be paid.`,
      field: "effectiveFrom",
      values,
    };
  }
  if (day > max) {
    return {
      ok: false,
      error: `A rate can start at most a year ahead, by ${formatFullDate(new Date(`${max}T00:00:00.000Z`))}.`,
      field: "effectiveFrom",
      values,
    };
  }

  await prisma.mentorPayRate.create({
    data: {
      mentorId: mentor.id,
      centsPerHour: rate.value,
      effectiveFrom: from.value,
      createdById: actor!.id,
    },
  });
  revalidatePath("/settings/platform/pay");
  revalidatePath("/mentor/pay");
  return {
    ok: true,
    message: `${mentor.name ?? mentor.email}: ${formatRate(rate.value)} from ${formatFullDate(from.value)}.`,
  };
}
