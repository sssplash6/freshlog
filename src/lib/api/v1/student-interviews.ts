import "server-only";

import type { User } from "@/generated/prisma/client";
import { personOf, slotTime } from "@/lib/api/v1/practice";
import { nameOf } from "@/lib/api/v1/sessions";
import type { FeedbackText, StudentInterviews } from "@/lib/api/v1/types";
import { mentorHasWorkedWith } from "@/lib/authz";
import { canActAsMentor } from "@/lib/constants";
import { templateName } from "@/lib/interview-templates";
import { interviewPhase } from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";
import { interviewsOfStudent } from "@/lib/student-interviews";
import { programToday } from "@/lib/when";

/**
 * A student's practice interviews, for a mentor who has worked with them, as
 * `/students/[id]` shows them (`page.tsx:144-151`): the student's own side
 * only, through `interviewsOfStudent`, which never selects the partner's
 * answers or notes, or anybody's draft.
 *
 * Null, which the route answers as a 404, for a student who is not there and
 * for any reader the page would show none to: somebody who is not a mentor, or
 * a mentor who has never held a grant, a session or a task with them. Admins
 * do not read them by managing the student.
 */
export async function studentInterviewsFor(reader: User, studentProfileId: string, now: Date = new Date()): Promise<StudentInterviews | null> {
  if (!canActAsMentor(reader)) return null;
  const profile = await prisma.studentProfile.findUnique({
    where: { id: studentProfileId },
    select: { id: true, userId: true, user: { select: { name: true, email: true } } },
  });
  if (!profile || !(await mentorHasWorkedWith(reader, profile))) return null;

  const text = (f: { summary: string | null; wentWell: string | null; toImprove: string | null } | null): FeedbackText | null =>
    f && { summary: f.summary ?? "", wentWell: f.wentWell ?? "", toImprove: f.toImprove ?? "" };

  const rows = await interviewsOfStudent(profile.userId);
  return {
    student: { id: profile.id, userId: profile.userId, name: nameOf(profile.user) },
    interviews: rows.map((r) => ({
      id: r.id,
      template: { id: r.template, name: templateName(r.template) },
      when: slotTime(r.slot),
      partner: personOf(r.partner),
      phase: interviewPhase(r, now),
      completedOn: r.completedAt ? programToday(r.completedAt) : null,
      notes: r.notes,
      answers: r.answers.map((a) => ({ index: a.questionIndex, question: a.question, text: a.text })),
      given: text(r.given),
      received: text(r.received),
    })),
  };
}
