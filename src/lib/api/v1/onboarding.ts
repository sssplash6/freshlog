import "server-only";

import type { OnboardingStep } from "@/lib/api/v1/types";
import { canActAsMentor, ROLES, USER_STATUS } from "@/lib/constants";
import { primaryEnrollment, studiesIn } from "@/lib/enrollments";
import { prisma } from "@/lib/prisma";
import { programOptions, toProgramOptions } from "@/lib/queries";
import type { User } from "@/generated/prisma/client";

/**
 * The one form this person has left, decided as /onboarding decides it
 * (`app/onboarding/page.tsx`), branch for branch and in its order, as a read.
 * The page's branching is what makes the wrong form unreachable: nothing in a
 * request picks the step, so a student cannot send the mentor's form, and a
 * staff-registered student cannot pick a program.
 *
 * `step: null` is every branch where the page asks nothing: a mentor or a
 * student with nothing missing (a wait, or their home), and staff.
 */
export async function onboardingFor(user: User): Promise<OnboardingStep> {
  // Mentors first, on `canActAsMentor`: a student who also mentors is
  // registered as the student they are.
  if (canActAsMentor(user) && user.role !== ROLES.STUDENT) {
    return user.name?.trim() ? { step: null } : { step: "mentor-name", name: user.name ?? "" };
  }
  if (user.role !== ROLES.STUDENT) return { step: null };

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    include: {
      enrollments: {
        include: { program: true, cohort: true, level: true },
        orderBy: { program: { name: "asc" } },
      },
    },
  });

  // Nobody registered this email: they say which program they are in.
  if (!profile) {
    return { step: "register", name: user.name ?? "", programs: toProgramOptions(await programOptions()) };
  }

  if (!user.name?.trim() || !profile.telegramUsername) {
    const pending = user.status === USER_STATUS.PENDING;
    // Where they study, never a program they are only visiting.
    const first = primaryEnrollment(studiesIn(profile.enrollments));
    return {
      step: "details",
      name: user.name ?? "",
      welcome: first ? `the ${first.program.name}` : "Freshman Academy",
      eyebrow: [pending ? "Step 1 of 2" : null, first?.cohort?.name].filter(Boolean).join(" · ") || null,
      pending,
    };
  }

  return { step: null };
}
