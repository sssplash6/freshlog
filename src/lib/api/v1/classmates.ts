import "server-only";

import { personOf, slotTime, type PracticeStudent } from "@/lib/api/v1/practice";
import type { Classmate } from "@/lib/api/v1/types";
import { ROLES, USER_STATUS } from "@/lib/constants";
import { studiesIn } from "@/lib/enrollments";
import { INTERVIEW_TEMPLATES } from "@/lib/interview-templates";
import { areClassmates } from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";
import { programWallClock } from "@/lib/when";

/**
 * A classmate as another student sees them, as `/student/interviews/people/[id]`
 * reads them: their name, the programs the two share, and the times they offer.
 *
 * Null, which the route answers as a 404, wherever the page is a 404: no such
 * student, not a student, not approved, unnamed, or not sharing one of the
 * reader's OWN programs. And for the reader themself, whom the page sends back
 * to the list. So an id cannot be used to learn who exists.
 *
 * No meeting link: a time's link is for whoever books it.
 */
export async function classmateFor({ profile }: PracticeStudent, id: string, now: Date = new Date()): Promise<Classmate | null> {
  if (id === profile.id) return null;
  const classmate = await prisma.studentProfile.findUnique({
    where: { id },
    select: {
      id: true,
      user: { select: { id: true, name: true, role: true, status: true } },
      enrollments: { select: { programId: true, exchangeId: true, program: { select: { name: true } } } },
      interviewSlots: {
        where: { startsAt: { gt: programWallClock(now) }, interview: null },
        select: { id: true, startsAt: true, minutes: true },
        orderBy: { startsAt: "asc" },
      },
    },
  });
  if (
    !classmate ||
    classmate.user.role !== ROLES.STUDENT ||
    classmate.user.status !== USER_STATUS.ACTIVE ||
    !classmate.user.name?.trim() ||
    !areClassmates(profile.enrollments, classmate.enrollments)
  ) {
    return null;
  }

  const mine = new Set(studiesIn(profile.enrollments).map((e) => e.programId));
  return {
    id: classmate.id,
    person: personOf(classmate.user),
    shared: studiesIn(classmate.enrollments)
      .filter((e) => mine.has(e.programId))
      .map((e) => e.program.name),
    slots: classmate.interviewSlots.map((s) => ({ id: s.id, when: slotTime(s) })),
    templates: INTERVIEW_TEMPLATES.map((t) => ({ id: t.id, name: t.name, summary: t.summary })),
  };
}
