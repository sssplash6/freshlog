import { assertProgramScope } from "@/lib/authz";
import { ROLES, USER_STATUS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import type { Prisma, User } from "@/generated/prisma/client";

/**
 * The account Google sign-in leaves on an address nobody registered: a
 * PENDING student, perhaps with a pending enrollment from onboarding, and
 * nothing else. It is the usual reason a sign-in email change finds its new
 * address TAKEN — the person already tried it — and it appears on no roster
 * an admin could remove it from. A stub like that is absorbed by the change
 * rather than blocking it. An account that holds anything — a session, an
 * allocation — is a real one and refuses: merging two real records is a
 * decision nobody has asked an email field for.
 *
 * "Never approved" is not the test, because an account can be ACTIVE and still
 * empty: a student whose enrollment was removed, or who was approved and never
 * given time, sits in no program with nothing logged. Nobody administers them
 * and no roster lists them, so there is no one else to ask about removing them.
 */
async function loadHolder(email: string) {
  return prisma.user.findUnique({
    where: { email },
    include: {
      studentProfile: {
        include: {
          enrollments: { select: { programId: true } },
          _count: { select: { sessions: true, hourAllocations: true } },
        },
      },
    },
  });
}

export type SignUpStub = NonNullable<Awaited<ReturnType<typeof loadHolder>>>;

/**
 * Who holds `email`, for an edit that wants to move `ownerId` onto it:
 * nobody (`stub: null`), an absorbable stub, or a real account (`error`).
 */
export async function claimEmail(
  actor: User,
  email: string,
  ownerId: string
): Promise<{ stub: SignUpStub | null } | { error: string }> {
  const taken = await loadHolder(email);
  if (!taken || taken.id === ownerId) return { stub: null };

  // PENDING says self-made: staff-registered students are ACTIVE from the
  // moment `createStudents` writes them, with a program. An ACTIVE account in
  // no program at all is just as empty, so that qualifies too.
  const profile = taken.studentProfile;
  const selfMade =
    taken.status === USER_STATUS.PENDING || (profile?.enrollments.length ?? 0) === 0;
  const absorbable =
    taken.role === ROLES.STUDENT &&
    selfMade &&
    (profile?._count.sessions ?? 0) === 0 &&
    (profile?._count.hourAllocations ?? 0) === 0;
  if (!absorbable) return { error: `${email} already has an account.` };

  // The stub's pending enrollments go with it, so the rule deleteStudent
  // applies holds here too: every program a removed record touches has to be
  // one of the actor's.
  for (const e of profile?.enrollments ?? []) {
    if (await assertProgramScope(actor, e.programId)) {
      return {
        error: `${email} has a sign-up waiting in a program you don't administer — its admin has to remove that account first.`,
      };
    }
  }
  return { stub: taken };
}

/** Delete a stub `claimEmail` returned, inside the edit's transaction. */
export async function removeStub(tx: Prisma.TransactionClient, stub: SignUpStub) {
  const profile = stub.studentProfile;
  if (profile) {
    // The same rows deleteStudent clears. Nothing is logged — absorbable means
    // exactly that — but the deletes stand in case the world moved between the
    // check and this transaction.
    await tx.hourAllotmentChange.deleteMany({ where: { studentId: profile.id } });
    await tx.hourAllocation.deleteMany({ where: { studentId: profile.id } });
    await tx.assignment.deleteMany({ where: { studentId: profile.id } });
    await tx.mentorFeedback.deleteMany({ where: { studentId: profile.id } });
    // Enrollments, tasks and the rest cascade with the profile.
    await tx.studentProfile.delete({ where: { id: profile.id } });
  }
  // Notices TO the stub, and the sign-up notice it left in admins' inboxes —
  // actorId is SetNull by default, which would keep a notification whose link
  // opens a record that no longer exists.
  await tx.notification.deleteMany({
    where: { OR: [{ userId: stub.id }, { actorId: stub.id }] },
  });
  await tx.user.delete({ where: { id: stub.id } });
}
