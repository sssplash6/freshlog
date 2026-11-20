"use server";

import { revalidatePath } from "next/cache";

import { adminWriteScope, scopeCovers } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { canActAsMentor, isArchived, ROLES, USER_STATUS } from "@/lib/constants";
import type { ActionState } from "@/lib/actions/shared";
import type { User } from "@/generated/prisma/client";

/**
 * Archiving: what happens to a student's or a mentor's account when they leave.
 *
 * It is the opposite of `deleteStudent`, and the reason both exist. Deleting is
 * for a record made by mistake, and is refused the moment a session stands
 * against it. Archiving is for a record that is TRUE and finished: it changes
 * the account's status and writes down when and who, and touches nothing else.
 * Every enrollment, pairing, grant, session, task and rating stays where it
 * was, so the hours somebody was given and the hours they used read the same
 * the day after as the day before, and restoring them is one write back.
 *
 * What changes is everything that reads `status`:
 *
 *   - they can no longer sign in, on the website or in the app
 *     (`getCurrentUser` answers nobody; the app's tokens are revoked here);
 *   - they are off the rosters, the pickers, search and the bell
 *     (`NOT_ARCHIVED`, spread into each of those queries);
 *   - nothing new is logged or granted against them, and no reminder or
 *     weekly email is sent to them.
 *
 * WHO MAY: somebody who administers EVERY program the person is in. One shared
 * program is enough to open their page, and not enough for this — archiving
 * takes them off every program's lists at once, so an admin of Global
 * Admissions must not be able to make a student vanish from the Master's
 * Program on their way past. That is `deleteStudent`'s rule, for its reason.
 */

const ALSO_ELSEWHERE_STUDENT =
  "They are also in a program you don't administer, so archiving them isn't yours to do. Take them off your program instead.";
const ALSO_ELSEWHERE_MENTOR =
  "They also mentor in a program you don't administer, so archiving them isn't yours to do. Remove them from your program instead.";

/** Does this actor administer every one of these programs — and at least one? */
async function administersAll(
  actor: User,
  programIds: readonly string[]
): Promise<boolean> {
  if (actor.platformAdmin) return true;
  // Somebody in no program at all belongs to no program admin: a fresh sign-up
  // waiting to be placed is a platform admin's to deal with, as on their page.
  if (programIds.length === 0) return false;
  const scope = await adminWriteScope(actor);
  return programIds.every((id) => scopeCovers(scope, id));
}

/** The two writes, in one transaction: the account, and its app sign-ins. */
async function archive(userId: string, actorId: string) {
  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { status: USER_STATUS.ARCHIVED, archivedAt: now, archivedById: actorId },
    }),
    // The phone's token would be refused by `getCurrentUser` anyway; ending it
    // the way `revokeToken` does is what stops a push being sent to a device
    // that can no longer open the app (`sweepPushes` reads only live tokens).
    prisma.deviceToken.deleteMany({ where: { userId } }),
    prisma.apiToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);
}

async function restore(userId: string, status: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { status, archivedAt: null, archivedById: null },
  });
}

/* ---------------------------------------------------------------- students --- */

/** A refusal, in the shape an action returns as it is. */
type Refused = { ok: false; error: string };
const refuse = (error: string): Refused => ({ ok: false, error });

async function studentFor(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return refuse("Sign in to do that.");
  const profile = await prisma.studentProfile.findUnique({
    where: { id: String(formData.get("studentProfileId") ?? "") },
    include: { user: true, enrollments: { select: { programId: true } } },
  });
  // "Not yours" and "does not exist" answer alike, so the refusal cannot be
  // used to find out which ids are real.
  if (!profile) return refuse("Student not found.");
  const programIds = profile.enrollments.map((e) => e.programId);
  const scope = await adminWriteScope(actor);
  const reaches =
    actor.platformAdmin || programIds.some((id) => scopeCovers(scope, id));
  if (!reaches) return refuse("Student not found.");
  if (!(await administersAll(actor, programIds))) {
    return refuse(ALSO_ELSEWHERE_STUDENT);
  }
  return { ok: true, actor, profile } as const;
}

/** Archive a student who has left. Their record is kept whole. */
export async function archiveStudent(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const found = await studentFor(formData);
  if (!found.ok) return found;
  const { actor, profile } = found;
  const name = profile.user.name ?? profile.user.email;

  if (isArchived(profile.user)) return { ok: true, message: `${name} is already archived.` };
  if (profile.user.status === USER_STATUS.PENDING) {
    return {
      ok: false,
      error: "They haven't been approved yet. Approve or reject them instead.",
    };
  }

  await archive(profile.userId, actor.id);
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `${name} is archived. Their hours and history are kept.`,
  };
}

/** Bring an archived student back, exactly as they were. */
export async function restoreStudent(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const found = await studentFor(formData);
  if (!found.ok) return found;
  const { profile } = found;
  const name = profile.user.name ?? profile.user.email;

  if (!isArchived(profile.user)) return { ok: true, message: `${name} isn't archived.` };
  // Only an approved student can be archived, so approved is what they return to.
  await restore(profile.userId, USER_STATUS.ACTIVE);
  revalidatePath("/", "layout");
  return { ok: true, message: `${name} is restored and can sign in again.` };
}

/* ----------------------------------------------------------------- mentors --- */

async function mentorFor(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return refuse("Sign in to do that.");
  const mentor = await prisma.user.findUnique({
    where: { id: String(formData.get("mentorId") ?? "") },
    include: {
      mentorAssignments: { select: { programId: true } },
      staffGrants: { select: { id: true } },
    },
  });
  if (!mentor || !canActAsMentor(mentor)) return refuse("Mentor not found.");
  const programIds = [...new Set(mentor.mentorAssignments.map((a) => a.programId))];
  const scope = await adminWriteScope(actor);
  const reaches =
    actor.platformAdmin || programIds.some((id) => scopeCovers(scope, id));
  if (!reaches) return refuse("Mentor not found.");
  if (!(await administersAll(actor, programIds))) {
    return refuse(ALSO_ELSEWHERE_MENTOR);
  }
  // An account that also administers something. Archiving it takes away an
  // admin's sign-in along with the mentor's, which is a decision about who
  // runs the platform — the one thing only a platform admin decides.
  const alsoStaff = mentor.role !== ROLES.MENTOR || mentor.staffGrants.length > 0;
  if (alsoStaff && !actor.platformAdmin) {
    return refuse("They are also an admin, so only a platform admin can archive or restore them.");
  }
  return { ok: true, actor, mentor, programIds } as const;
}

/** Archive a mentor who has left. Their pairings, hours and sessions are kept. */
export async function archiveMentor(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const found = await mentorFor(formData);
  if (!found.ok) return found;
  const { actor, mentor } = found;
  const name = mentor.name ?? mentor.email;

  if (mentor.id === actor.id) {
    return refuse("You can't archive your own account.");
  }
  if (mentor.platformAdmin) {
    return {
      ok: false,
      error: `${name} runs the platform. Take that away in Settings first.`,
    };
  }
  if (isArchived(mentor)) return { ok: true, message: `${name} is already archived.` };

  await archive(mentor.id, actor.id);
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `${name} is archived. Their sessions and the hours students hold with them are kept.`,
  };
}

/** Bring an archived mentor back into the programs they were paired with. */
export async function restoreMentor(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const found = await mentorFor(formData);
  if (!found.ok) return found;
  const { mentor, programIds } = found;
  const name = mentor.name ?? mentor.email;

  if (!isArchived(mentor)) return { ok: true, message: `${name} isn't archived.` };
  // The rule `updateMentor` keeps: a plain mentor paired with nothing is
  // UNASSIGNED, and everybody else is ACTIVE. Derived rather than remembered,
  // so a pairing removed while they were away is already accounted for.
  const unplaced = mentor.role === ROLES.MENTOR && programIds.length === 0;
  await restore(mentor.id, unplaced ? USER_STATUS.UNASSIGNED : USER_STATUS.ACTIVE);
  revalidatePath("/", "layout");
  return { ok: true, message: `${name} is restored and can sign in again.` };
}
