import "server-only";

import { ASSIGNMENT_PROGRESS, CHARGED_SESSION } from "@/lib/constants";
import { deadlinePassed } from "@/lib/deadlines";
import type { prisma } from "@/lib/prisma";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const money = (n: number) => Number(n.toFixed(2));

/**
 * Carry a student's unused time from the program they are leaving into the one
 * they are moved to.
 *
 * Until 30 September 2026 a move re-pointed the enrollment and left the ledger
 * behind: every grant stayed keyed to the old program, the student page scoped
 * it out, and the admin who made the move read "all her hours are gone". The
 * hours are per program — that does not change — so the unused ones are
 * re-granted here, the way `transferMentorAllocation` moves them between two
 * mentors: the source goes down by exactly what the target goes up, and each
 * half is audited.
 *
 * Only UNUSED, UNEXPIRED minutes carry. What was delivered is the old program's
 * record and stays there; forfeited time was lost before the move and is not
 * revived by it. Each grant keeps its own deadline.
 *
 *  - a mentor's time goes to the same mentor, who is paired into the new
 *    program if they are not already;
 *  - the unassigned pool, and an old hour bank, go to the new pool;
 *  - into a program that runs an hour bank, everything goes to the bank, since
 *    every meeting there draws the bank and time beside it would never be spent.
 *
 * Money follows the minutes in proportion, but only when both programs track
 * it — otherwise the payment stays recorded where it was taken.
 *
 * Untouched work goes with the time: a task nothing was logged against, and a
 * mentor-set task the student has not begun. Work already started stays with
 * the program its sessions belong to, because a session may only name a task
 * from its own program.
 *
 * Called from inside the move's transaction, after the new program's standard
 * grant, so the carried time tops up that grant rather than preventing it.
 */
export async function carryForward(
  tx: Tx,
  opts: { studentId: string; fromProgramId: string; toProgramId: string; actorId: string }
): Promise<{ minutes: number; mentorIds: string[]; tasks: number }> {
  const { studentId, fromProgramId, toProgramId, actorId } = opts;
  const [from, to] = await Promise.all([
    tx.program.findUniqueOrThrow({ where: { id: fromProgramId } }),
    tx.program.findUniqueOrThrow({ where: { id: toProgramId } }),
  ]);

  const sources = await tx.hourAllocation.findMany({
    where: { studentId, programId: fromProgramId, exchangeId: null },
    orderBy: { createdAt: "asc" },
  });

  const carriedMentors = new Set<string>();
  let carried = 0;
  const audit: {
    studentId: string;
    programId: string;
    mentorId: string | null;
    changedById: string;
    oldMinutes: number;
    newMinutes: number;
  }[] = [];

  for (const row of sources) {
    if (deadlinePassed(row.deadline)) continue;

    // What this row has already been drawn down by — the same key the balance
    // uses: a bank by every bank meeting, a mentor by their own, a pool by none.
    let used = 0;
    const drawnBy = row.isBank
      ? { fromBank: true }
      : row.mentorId
        ? { mentorId: row.mentorId, fromBank: false }
        : null;
    if (drawnBy) {
      const agg = await tx.session.aggregate({
        where: {
          studentId,
          programId: fromProgramId,
          ...drawnBy,
          ...CHARGED_SESSION,
        },
        _sum: { minutes: true },
      });
      used = agg._sum.minutes ?? 0;
    }
    const spare = Math.max(0, row.minutes - used);
    if (spare === 0) continue;

    const paidMoved =
      from.tracksPayment && to.tracksPayment && row.amountPaid != null && row.minutes > 0
        ? money((row.amountPaid * spare) / row.minutes)
        : null;

    await tx.hourAllocation.update({
      where: { id: row.id },
      data: {
        minutes: row.minutes - spare,
        ...(paidMoved != null ? { amountPaid: money((row.amountPaid ?? 0) - paidMoved) } : {}),
      },
    });
    audit.push({
      studentId,
      programId: fromProgramId,
      mentorId: row.isBank ? null : row.mentorId,
      changedById: actorId,
      oldMinutes: row.minutes,
      newMinutes: row.minutes - spare,
    });

    const toBank = to.hourBank;
    const toMentorId = toBank || row.isBank ? null : row.mentorId;
    // findFirst, not the unique key: a null mentor is never equal to another
    // null in a unique index, so the pool and the bank cannot be looked up by it.
    const dest = await tx.hourAllocation.findFirst({
      where: {
        studentId,
        programId: toProgramId,
        mentorId: toMentorId,
        isBank: toBank,
        exchangeId: null,
      },
    });
    const destOld = dest?.minutes ?? 0;
    if (dest) {
      // The later of the two dates, as a top-up keeps: hours already held are
      // never shortened by the ones arriving.
      const deadline = dest.deadline > row.deadline ? dest.deadline : row.deadline;
      await tx.hourAllocation.update({
        where: { id: dest.id },
        data: {
          minutes: destOld + spare,
          deadline,
          ...(deadline.getTime() !== dest.deadline.getTime() ? { deadlineStage: null } : {}),
          ...(paidMoved != null ? { amountPaid: money((dest.amountPaid ?? 0) + paidMoved) } : {}),
        },
      });
    } else {
      await tx.hourAllocation.create({
        data: {
          studentId,
          programId: toProgramId,
          mentorId: toMentorId,
          minutes: spare,
          deadline: row.deadline,
          isBank: toBank,
          ...(paidMoved != null ? { amountPaid: paidMoved } : {}),
        },
      });
    }
    audit.push({
      studentId,
      programId: toProgramId,
      mentorId: toMentorId,
      changedById: actorId,
      oldMinutes: destOld,
      newMinutes: destOld + spare,
    });

    carried += spare;
    if (row.mentorId) carriedMentors.add(row.mentorId);
  }

  if (audit.length > 0) await tx.hourAllotmentChange.createMany({ data: audit });

  // Untouched work. A task with a session against it has started, whatever its
  // progress says, and stays with the program that session was logged in.
  const assignments = await tx.assignment.updateMany({
    where: {
      studentId,
      programId: fromProgramId,
      progress: { not: ASSIGNMENT_PROGRESS.DONE },
      sessions: { none: {} },
    },
    data: { programId: toProgramId },
  });
  const movedTasks = await tx.studentTask.findMany({
    where: { studentId, programId: fromProgramId, percent: 0, completedAt: null },
    select: { id: true, mentorId: true },
  });
  if (movedTasks.length > 0) {
    await tx.studentTask.updateMany({
      where: { id: { in: movedTasks.map((t) => t.id) } },
      data: { programId: toProgramId },
    });
  }
  const movedAssignmentMentors = await tx.assignment.findMany({
    where: { studentId, programId: toProgramId, mentorId: { not: null } },
    select: { mentorId: true },
  });

  // Everyone whose time or work came along must be able to meet her there.
  const mentorIds = new Set([
    ...carriedMentors,
    ...movedTasks.map((t) => t.mentorId),
    ...movedAssignmentMentors.map((a) => a.mentorId!),
  ]);
  for (const mentorId of mentorIds) {
    const paired = await tx.mentorAssignment.findFirst({
      where: { mentorId, programId: toProgramId },
    });
    if (!paired) {
      await tx.mentorAssignment.create({ data: { mentorId, programId: toProgramId, cohortId: null } });
    }
  }

  return {
    minutes: carried,
    mentorIds: [...carriedMentors],
    tasks: assignments.count + movedTasks.length,
  };
}
