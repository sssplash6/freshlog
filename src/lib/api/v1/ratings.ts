import "server-only";

import type { StudentRatings } from "@/lib/api/v1/types";
import { nameOf } from "@/lib/api/v1/sessions";
import { allocationSummary } from "@/lib/hours";
import { prisma } from "@/lib/prisma";
import { programToday } from "@/lib/when";

/**
 * A student's ratings, read as /student/feedback reads them: the mentors they
 * may rate are every mentor `allocationSummary` names (time held, or a session
 * logged against them) plus every one met through an hour bank, which holds no
 * allocation of its own; what they have sent is every report, newest first.
 */
export async function ratingsFor(studentId: string): Promise<StudentRatings> {
  const [hours, given, met] = await Promise.all([
    allocationSummary(studentId),
    prisma.mentorFeedback.findMany({
      where: { studentId },
      include: { mentor: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.session.findMany({
      where: { studentId, fromBank: true },
      distinct: ["mentorId"],
      select: { mentor: true },
    }),
  ]);
  const mentors = [...hours.perMentor.flatMap((m) => (m.mentor ? [m.mentor] : [])), ...met.map((s) => s.mentor)]
    .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i)
    .map((m) => ({ id: m.id, name: nameOf(m) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    mentors,
    given: given.map((f) => ({
      id: f.id,
      mentor: { id: f.mentor.id, name: nameOf(f.mentor) },
      rating: f.rating,
      comment: f.comment,
      sentOn: programToday(f.createdAt),
    })),
  };
}
