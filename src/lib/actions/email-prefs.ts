"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
import {
  EMAIL_BY_DEFAULT,
  NOTIFICATION_CATEGORY,
  WEEKLY_SUMMARY_PREF,
  type NotificationCategory,
} from "@/lib/constants";

const PREFERENCE_CATEGORIES: string[] = Object.values(NOTIFICATION_CATEGORY);

/**
 * What each person wants to hear about, and how.
 *
 * Two doors, on purpose. Signed-in people use /settings. The link in the email
 * footer has to work for someone who is not signed in and never will be — a
 * student who wants the mail to stop should not have to find their password to
 * say so — so that path authorizes on the signed token in the URL instead.
 */

/**
 * The weekly summary toggle.
 *
 * Writes BOTH the preference row and `User.weeklyDigest`. The column is still
 * what the HMAC unsubscribe path writes, and those links are already sitting
 * in inboxes; keeping the two in step for one release is the price of not
 * breaking them. The column goes when the last of those emails has aged out.
 */
export async function setWeeklyDigest(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  // The checkbox is absent from the payload when unchecked.
  const on = formData.get("weeklyDigest") === "on";
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { weeklyDigest: on } }),
    prisma.notificationPreference.upsert({
      where: { userId_category: { userId: user.id, category: WEEKLY_SUMMARY_PREF } },
      update: { email: on },
      create: { userId: user.id, category: WEEKLY_SUMMARY_PREF, email: on },
    }),
  ]);

  revalidatePath("/", "layout");
}

/**
 * One category's two switches, from the matrix on /settings.
 *
 * Absence is the default — in the app, not by email — so a row is written only
 * when somebody says something other than that, and a person who sets it back
 * to the default has their row deleted rather than kept as a no-op.
 */
export async function setNotificationPreference(
  formData: FormData
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  const category = String(formData.get("category") ?? "");
  if (!PREFERENCE_CATEGORIES.includes(category)) return;

  const inApp = formData.get("inApp") === "on";
  const email = formData.get("email") === "on";

  // The default is not "in the app only" for every category any more — a task
  // is emailed unless somebody says otherwise (`EMAIL_BY_DEFAULT`). A row is
  // still written only when the answer differs from the default, so a student
  // who turns task mail off HAS a row and a student who leaves it on does not.
  if (inApp && email === EMAIL_BY_DEFAULT[category as NotificationCategory]) {
    await prisma.notificationPreference.deleteMany({
      where: { userId: user.id, category },
    });
  } else {
    await prisma.notificationPreference.upsert({
      where: { userId_category: { userId: user.id, category } },
      update: { inApp, email },
      create: { userId: user.id, category, inApp, email },
    });
  }

  revalidatePath("/", "layout");
}

/**
 * The email footer link. Authorized by the HMAC in the URL, so it works from an
 * inbox with no session. Idempotent — unsubscribing twice is a no-op, which
 * matters because mail clients retry.
 *
 * A plain form action that redirects, rather than the useActionState pattern
 * used elsewhere: this page is opened from an email client, sometimes with
 * scripting off, and an unsubscribe button that needs React to have hydrated is
 * an unsubscribe button that sometimes does nothing.
 */
export async function unsubscribeWeekly(formData: FormData): Promise<void> {
  const userId = String(formData.get("u") ?? "");
  const token = String(formData.get("t") ?? "");
  if (!verifyUnsubscribeToken(userId, token)) {
    redirect("/unsubscribe?state=invalid");
  }

  // updateMany, not update: a deleted account should not throw here. Both
  // places are written, for the same reason the toggle writes both.
  await prisma.user.updateMany({
    where: { id: userId },
    data: { weeklyDigest: false },
  });
  await prisma.notificationPreference.updateMany({
    where: { userId, category: WEEKLY_SUMMARY_PREF },
    data: { email: false },
  });

  redirect("/unsubscribe?state=done");
}
