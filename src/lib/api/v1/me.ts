import "server-only";

import { apiAvatarPath } from "@/lib/api/v1/account";
import type { ApiRole, MeResponse, Onboarding } from "@/lib/api/v1/types";
import { adminScope, scopeIsEmpty } from "@/lib/authz";
import { canActAsMentor, ROLES, USER_STATUS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import type { User } from "@/generated/prisma/client";

/**
 * What /api/v1/me says about somebody: who they are, which parts of the app they
 * may use, and what they still have to set up before the first of those works.
 *
 * It asks the website's own questions, so the app never guesses a rule: the
 * admin half is `adminScope` (a role alone grants nothing), the mentor half is
 * `canActAsMentor`, and what is left to set up is what `/onboarding` checks.
 */
export async function meFor(user: User): Promise<MeResponse> {
  const [profile, scope, unread] = await Promise.all([
    prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { id: true, telegramUsername: true },
    }),
    adminScope(user),
    prisma.notification.count({ where: { userId: user.id, read: false } }),
  ]);

  // The order is where the website sends somebody who has not picked a side: a
  // student to the student side, else a person who administers to the admin side
  // (a mentor who was granted a program lands there too), else the mentor side.
  const roles: ApiRole[] = [];
  if (user.role === ROLES.STUDENT) roles.push("student");
  if (!scopeIsEmpty(scope)) roles.push("admin");
  if (canActAsMentor(user)) roles.push("mentor");

  return {
    id: user.id,
    studentProfileId: profile?.id ?? null,
    name: user.name,
    email: user.email,
    // A string column that constants.ts keeps to these three.
    status: user.status as MeResponse["status"],
    roles,
    platformAdmin: user.platformAdmin,
    avatarPath: apiAvatarPath(user),
    unread,
    onboarding: onboardingFor(roles[0], user, profile),
    deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
  };
}

/**
 * What the first role still needs. Only the first is asked: it is the home the
 * app opens, and the others are not opened until the person switches to them.
 */
function onboardingFor(
  home: ApiRole | undefined,
  user: User,
  profile: { telegramUsername: string | null } | null
): Onboarding {
  switch (home) {
    case undefined:
      return "no-access";
    case "student":
      // The profile before the wait, as on /onboarding: somebody who can still
      // do something is asked to do it before they are told to wait.
      if (!profile || !user.name?.trim() || !profile.telegramUsername) {
        return "student-profile";
      }
      return user.status === USER_STATUS.PENDING ? "pending-approval" : null;
    case "mentor":
      if (!user.name?.trim()) return "mentor-name";
      return user.status === USER_STATUS.UNASSIGNED ? "unassigned" : null;
    case "admin":
      // An admin is created with a name, and their grants are somebody else's
      // to give, so there is nothing for them to finish. That makes it null
      // whatever their status or name, so null does not mean ACTIVE: the app
      // reads `status` too (see `Onboarding` in src/lib/api/v1/types.ts).
      return null;
  }
}
