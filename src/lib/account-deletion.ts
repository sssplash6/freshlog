import "server-only";

import type { User } from "@/generated/prisma/client";

import { ROLES, NOTIFICATION_TYPES, canActAsMentor } from "@/lib/constants";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

/**
 * Deleting your own account, as the App Store asks of any app you can sign up
 * in (rule 5.1.1(v)): you ask in the app, and a platform admin deletes the
 * account by hand within ACCOUNT_DELETION_DAYS. By hand, because a person's
 * sessions are also their mentor's record and their program's hours, and what
 * becomes of those is a person's call, not a cascade's.
 *
 * The request is the date on the user. Asking twice keeps the first date and
 * tells nobody again; taking it back clears it.
 */

/** How long the app promises it takes. */
export const ACCOUNT_DELETION_DAYS = 30;

/** Where an admin goes to act on it: the person's page, when they have one. */
async function pageOf(user: User): Promise<string | undefined> {
  if (user.role === ROLES.STUDENT) {
    const profile = await prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (profile) return `/students/${profile.id}`;
  }
  if (canActAsMentor(user)) return `/mentors/${user.id}`;
  return undefined;
}

/** Asks for `user`'s account to be deleted; the date it was asked. */
export async function requestDeletion(user: User): Promise<Date> {
  // Only the first ask writes, so two taps (or two phones) tell the admins once.
  const { count } = await prisma.user.updateMany({
    where: { id: user.id, deletionRequestedAt: null },
    data: { deletionRequestedAt: new Date() },
  });
  const { deletionRequestedAt } = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { deletionRequestedAt: true },
  });
  if (count === 0) return deletionRequestedAt!;

  const admins = await prisma.user.findMany({
    where: { platformAdmin: true },
    select: { id: true },
  });
  await notify(prisma, {
    to: admins.map((a) => a.id),
    type: NOTIFICATION_TYPES.DELETION_REQUESTED,
    message: `${user.name ?? user.email} asked for their account to be deleted. Delete it within ${ACCOUNT_DELETION_DAYS} days.`,
    href: await pageOf(user),
    actorId: user.id,
  });
  return deletionRequestedAt!;
}

/** Takes the request back, if there was one. */
export async function withdrawDeletion(user: User): Promise<void> {
  await prisma.user.update({
    where: { id: user.id },
    data: { deletionRequestedAt: null },
  });
}
