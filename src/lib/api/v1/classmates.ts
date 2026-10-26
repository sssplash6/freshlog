import "server-only";

import { personOf, slotTime, type PracticeStudent } from "@/lib/api/v1/practice";
import type { Classmate } from "@/lib/api/v1/types";
import { ROLES, USER_STATUS } from "@/lib/constants";
import { studiesIn } from "@/lib/enrollments";
import { INTERVIEW_TEMPLATES } from "@/lib/interview-templates";
import { prisma } from "@/lib/prisma";
import { programWallClock } from "@/lib/when";

/**
 * A classmate as another student sees them, as `/student/interviews/people/[id]`
 * reads them: their name, their own programs, and the times they offer. Any
 * approved student is a classmate, whatever their program.
 *
 * Null, which the route answers as a 404, wherever the page is a 404: no such
 * student, not a student, not approved, or unnamed. And for the reader
 * themself, whom the page sends back to the list. So an id cannot be used to
 * learn who exists.
 *
 * No meeting link: a time's link is for whoever books it.
 */
export async function classmateFor({ profile }: PracticeStudent, id: string, now: Date = new Date()): Promise<Classmate | null> {
  if (id === profile.id) return null;
  const classmate = await prisma.studentProfile.findUnique({
    where: { id },
    select: {
      id: true,
      user: {
        select: {
          id: true,
          name: true,
          role: true,
          status: true,
          // Their times for classmates: a mentor's are not offered here.
          interviewSlots: {
            where: { asMentor: false, startsAt: { gt: programWallClock(now) }, interview: null },
            select: { id: true, startsAt: true, minutes: true },
            orderBy: { startsAt: "asc" },
          },
        },
      },
      enrollments: { select: { programId: true, exchangeId: true, program: { select: { name: true } } } },
    },
  });
  if (
    !classmate ||
    classmate.user.role !== ROLES.STUDENT ||
    classmate.user.status !== USER_STATUS.ACTIVE ||
    !classmate.user.name?.trim()
  ) {
    return null;
  }

  return {
    id: classmate.id,
    person: personOf(classmate.user),
    shared: studiesIn(classmate.enrollments).map((e) => e.program.name),
    slots: classmate.user.interviewSlots.map((s) => ({ id: s.id, when: slotTime(s) })),
    templates: INTERVIEW_TEMPLATES.map((t) => ({ id: t.id, name: t.name, summary: t.summary })),
  };
}
