import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * One student's practice interviews, as their mentors read them.
 *
 * The student's own side only: what they answered, what they noted, the
 * feedback they sent and the feedback sent about them. The partner's answers
 * and notes belong to the partner and are never selected, and a feedback draft
 * is never selected from either side — `submittedAt: { not: null }` is in the
 * query, not in the page, so an unfinished judgement cannot be rendered by
 * accident. The partner is a name and a face only: their email is not selected,
 * since they may belong to a program the reader has no standing in.
 *
 * Callers gate on `mentorHasWorkedWith` first; this reads whatever it is given.
 */
export async function interviewsOfStudent(studentId: string) {
  const rows = await prisma.peerInterview.findMany({
    where: { OR: [{ hostId: studentId }, { guestId: studentId }] },
    select: {
      id: true,
      hostId: true,
      template: true,
      completedAt: true,
      hostNotes: true,
      guestNotes: true,
      slot: { select: { startsAt: true, minutes: true } },
      host: { select: { user: { select: { id: true, name: true, avatarUpdatedAt: true } } } },
      guest: { select: { user: { select: { id: true, name: true, avatarUpdatedAt: true } } } },
      answers: {
        where: { studentId },
        orderBy: { questionIndex: "asc" },
        select: { questionIndex: true, question: true, text: true },
      },
      feedback: {
        where: { submittedAt: { not: null } },
        select: { fromId: true, summary: true, wentWell: true, toImprove: true },
      },
    },
  });

  return rows
    .map((row) => {
      const hosting = row.hostId === studentId;
      return {
        id: row.id,
        template: row.template,
        completedAt: row.completedAt,
        slot: row.slot,
        partner: (hosting ? row.guest : row.host).user,
        notes: (hosting ? row.hostNotes : row.guestNotes) ?? "",
        answers: row.answers,
        given: row.feedback.find((f) => f.fromId === studentId) ?? null,
        received: row.feedback.find((f) => f.fromId !== studentId) ?? null,
      };
    })
    .sort((a, b) => b.slot.startsAt.getTime() - a.slot.startsAt.getTime());
}

export type StudentInterview = Awaited<ReturnType<typeof interviewsOfStudent>>[number];
