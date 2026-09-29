import "server-only";

import { NOTIFICATION_TYPES } from "@/lib/constants";
import { formatDate, formatDuration } from "@/lib/format";
import { notify, notificationHref } from "@/lib/notify";
import type { prisma } from "@/lib/prisma";
import { programToday } from "@/lib/when";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * The use-by date of a standard grant: `days` after the program day the
 * student joined, stored the way a date field stores a day (UTC midnight — see
 * `parseDateField`), so it reads, compares and forfeits exactly like a
 * deadline an admin typed.
 */
export function standardDeadline(today: string, days: number): Date {
  const start = new Date(`${today}T00:00:00.000Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + days));
}

/**
 * Give a student who has just joined a program that program's standard grant.
 *
 * Called from inside the transaction that creates the membership, so a student
 * is never in a level without the hours the level promises, nor holding hours
 * for a membership that was rolled back. It is the admin grant with no mentor,
 * written the same three ways — the pool allocation, the audit row, the
 * student's notification — and credited to whoever let the student in.
 *
 * Where the program runs an hour bank, the grant opens the student's bank
 * rather than filling the pool (see below).
 *
 * It does nothing when the program has no standard, and nothing when the
 * student already holds time in THIS program: a correction that moves somebody
 * back, or a second path into the same program, must not grant twice. Hours in
 * another program are that program's, and do not count.
 *
 * Returns what was granted, so the calling action can say so; null otherwise.
 */
export async function grantStandardHours(
  tx: Tx,
  opts: { studentId: string; programId: string; actorId: string; today?: string }
): Promise<{ minutes: number; deadline: Date } | null> {
  const program = await tx.program.findUnique({
    where: { id: opts.programId },
    select: { name: true, standardMinutes: true, standardDays: true, hourBank: true },
  });
  if (!program || program.standardMinutes === null || program.standardDays === null) {
    return null;
  }

  const held = await tx.hourAllocation.count({
    where: { studentId: opts.studentId, programId: opts.programId },
  });
  if (held > 0) return null;

  const profile = await tx.studentProfile.findUnique({
    where: { id: opts.studentId },
    select: { userId: true },
  });
  if (!profile) return null;

  const minutes = program.standardMinutes;
  const deadline = standardDeadline(opts.today ?? programToday(), program.standardDays);

  // In a program with an hour bank the standard IS the bank: every meeting
  // there draws the bank, and time granted beside it would never be spent. A
  // new member has logged nothing, so there are no past hours to ask about.
  const bank = program.hourBank;
  await tx.hourAllocation.create({
    data: {
      studentId: opts.studentId,
      programId: opts.programId,
      mentorId: null,
      minutes,
      deadline,
      isBank: bank,
    },
  });
  await tx.hourAllotmentChange.create({
    data: {
      studentId: opts.studentId,
      programId: opts.programId,
      mentorId: null,
      changedById: opts.actorId,
      oldMinutes: 0,
      newMinutes: minutes,
    },
  });
  await notify(tx, {
    to: [profile.userId],
    type: NOTIFICATION_TYPES.HOURS_GRANTED,
    actorId: opts.actorId,
    href: notificationHref.studentHome(),
    message: bank
      ? `You were given an hour bank of ${formatDuration(minutes)} in ${program.name}. It must be used by ${formatDate(deadline)}.`
      : `You were granted ${formatDuration(minutes)} in ${program.name}. They must be used by ${formatDate(deadline)}.`,
  });

  return { minutes, deadline };
}
