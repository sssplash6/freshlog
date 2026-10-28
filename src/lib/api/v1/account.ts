import "server-only";

import type { ApiAccount, NoticePref } from "@/lib/api/v1/types";
import { avatarUrl, type AvatarPerson } from "@/lib/avatar";
import { OPEN_BUG_STATUSES } from "@/lib/bugs";
import { hasUnseenChangelog, readChangelog } from "@/lib/changelog";
import {
  EMAIL_BY_DEFAULT,
  NOTIFICATION_CATEGORY_HINTS,
  NOTIFICATION_CATEGORY_LABELS,
  canActAsMentor,
  type NotificationCategory,
} from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import type { User } from "@/generated/prisma/client";

/**
 * A picture's address for the app: `avatarUrl`'s, `?v=` and all, on the API's
 * own copy of the route. The website's /api/avatar sits behind its cookie check
 * (src/proxy.ts), which a request carrying only the bearer never passes.
 */
export function apiAvatarPath(person: AvatarPerson): string | null {
  const web = avatarUrl(person);
  return web && web.replace(/^\/api\/avatar\//, "/api/v1/avatars/");
}

/**
 * What Account shows that /me doesn't, read as /settings reads it
 * (`app/settings/page.tsx`): the student's handle, a mentor's pairings with the
 * page's label, and each category's switches defaulted as the page defaults
 * them, with each category's Push switch (on unless turned off). Plus the two
 * marks Account carries: an unread changelog and open reports.
 */
export async function accountFor(user: User): Promise<ApiAccount> {
  const isMentor = canActAsMentor(user);
  const [profile, assignments, prefs, pushPrefs, openBugs, changelog] = await Promise.all([
    prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { telegramUsername: true },
    }),
    isMentor
      ? prisma.mentorAssignment.findMany({
          where: { mentorId: user.id },
          include: { program: true, cohort: true },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve(null),
    prisma.notificationPreference.findMany({ where: { userId: user.id } }),
    prisma.pushPreference.findMany({ where: { userId: user.id } }),
    prisma.bugReport.count({
      where: { reporterId: user.id, status: { in: OPEN_BUG_STATUSES } },
    }),
    readChangelog(),
  ]);
  const prefOf = new Map(prefs.map((p) => [p.category, p]));
  const pushOf = new Map(pushPrefs.map((p) => [p.category, p.on]));

  const notices: NoticePref[] = (
    Object.keys(NOTIFICATION_CATEGORY_LABELS) as NotificationCategory[]
  ).map((category) => ({
    category,
    label: NOTIFICATION_CATEGORY_LABELS[category],
    hint: NOTIFICATION_CATEGORY_HINTS[category],
    inApp: prefOf.get(category)?.inApp ?? true,
    email: prefOf.get(category)?.email ?? EMAIL_BY_DEFAULT[category],
    // No row is on: a person who allowed notifications on a phone wants them.
    push: pushOf.get(category) ?? true,
  }));

  return {
    name: user.name,
    email: user.email,
    avatarPath: apiAvatarPath(user),
    telegram: profile ? { handle: profile.telegramUsername } : null,
    bookingLinks:
      assignments?.map((a) => ({
        assignment: a.id,
        label: a.cohort ? `${a.program.name} · ${a.cohort.name}` : a.program.name,
        url: a.calendlyUrl,
      })) ?? null,
    weeklyDigest: user.weeklyDigest,
    notices,
    whatsNew: hasUnseenChangelog(changelog, user),
    openBugs,
  };
}
