"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { NOTIFICATION_TYPES, ROLES } from "@/lib/constants";
import { notify, staffIdsFor } from "@/lib/notify";
import { assignmentsForStudentWhere } from "@/lib/queries";
import type { ActionState } from "@/lib/actions/shared";

function parseRating(raw: FormDataEntryValue | null): number | null {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

async function requireStudentProfile() {
  const user = await getCurrentUser();
  if (!user || user.role !== ROLES.STUDENT) return null;
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    include: { enrollments: { select: { programId: true, cohortId: true } } },
  });
  return profile;
}

/**
 * Student rates a mentor (1–5 + optional comment). The mentor must be
 * relevant to the student: currently assigned to their program (or cohort),
 * or someone they've had a session with. The writer's name is shown to their
 * admins and to nobody else — anonymous to the mentor and to leaders.
 */
export async function submitMentorFeedback(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireStudentProfile();
  if (!profile) {
    return { ok: false, error: "Only students can leave mentor feedback." };
  }

  const rating = parseRating(formData.get("rating"));
  if (!rating) return { ok: false, error: "Pick a rating from 1 to 5." };
  const comment = String(formData.get("comment") ?? "").trim() || null;

  const mentorId = String(formData.get("mentorId") ?? "");
  const [assignment, pastSession] = await Promise.all([
    prisma.mentorAssignment.findFirst({
      where: { mentorId, ...assignmentsForStudentWhere(profile) },
    }),
    prisma.session.findFirst({
      where: { mentorId, studentId: profile.id },
    }),
  ]);
  if (!assignment && !pastSession) {
    return { ok: false, error: "Pick one of your mentors." };
  }

  // Every program the student is in: a rating is about a mentor they work
  // with, and which of their programs that mentor sits in is not a question the
  // student was asked. The admins of all of them hear it.
  const staff = (
    await Promise.all(profile.enrollments.map((e) => staffIdsFor(e.programId)))
  ).flat();

  await prisma.$transaction(async (tx) => {
    await tx.mentorFeedback.create({
      data: { studentId: profile.id, mentorId, rating, comment },
    });
    // The rating, not the comment. A low score is the thing staff need to see
    // today; what the student wrote about their mentor belongs on the feedback
    // page behind the reader's own grants, not pushed into a feed and an
    // email where it outlives the context it was written in.
    await notify(tx, {
      to: staff,
      type: NOTIFICATION_TYPES.FEEDBACK_RECEIVED,
      message: `A student rated their mentor ${rating} out of 5.`,
      href: "/feedback",
    });
  });

  revalidatePath("/", "layout");
  return { ok: true, message: "Thanks! Your mentor feedback was recorded." };
}
