import { redirect } from "next/navigation";

import {
  DetailsStepForm,
  NameStepForm,
  RegistrationStepForm,
} from "@/components/forms/profile-forms";
import { PageTitle } from "@/components/ui/section";
import { canActAsMentor, ROLES, USER_STATUS } from "@/lib/constants";
import { requireUser } from "@/lib/dal";
import { enrollmentsLabel, primaryEnrollment, studiesIn } from "@/lib/enrollments";
import { homeFor, profileOf } from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import { programOptions, toProgramOptions } from "@/lib/queries";

/**
 * One step: what is being asked, why, and the form that answers it.
 *
 * `max-w-md` (448px) inside the shell's `max-w-2xl` (672px): two or three
 * fields stretched to the shell's full measure read as a page that has not
 * finished loading, and on the phone most of these readers are holding, the
 * two measures are the same thing anyway.
 */
function Step({
  eyebrow,
  title,
  sentence,
  form,
}: {
  eyebrow?: string;
  title: string;
  sentence: string;
  /** Absent on the one step that asks nothing: waiting is not a form. */
  form?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md space-y-4">
      <PageTitle eyebrow={eyebrow} title={title} subtitle={sentence} />
      {form && (
        <div className="rounded-xl border border-line bg-surface shadow-sm p-5 sm:p-6">
          {form}
        </div>
      )}
    </div>
  );
}

/**
 * The door. Four ways through it, and the reader's own record picks which.
 *
 * This replaces `/student/onboarding` and `/mentor/onboarding`, which were two
 * routes for one moment, each gated on a role and each with its own idea of
 * what "registered" means. Branching here instead of in the URL is what makes
 * the wrong branch unreachable: there is no step parameter to edit, so a
 * student cannot open the mentor form and a mentor cannot open the program
 * picker, and neither can be linked into the other's step by accident.
 *
 * The fourth branch — awaiting approval — is the wall that used to stand on
 * `/student`. It belongs here: everything else on that home is about time a
 * PENDING student does not have yet, `/student/book` turns them away, and the
 * page they were sent to had one row on it saying so. The step says the same
 * sentence in the place where nothing else is competing with it.
 */
export default async function OnboardingPage() {
  const user = await requireUser();

  // Mentors first, and on `canActAsMentor` rather than `role === MENTOR`. The
  // page this replaces used `requireRole(MENTOR)`, which turned away the
  // dual-role admin `requireMentor` had just sent here — /mentor bounced them
  // to onboarding, onboarding bounced them to /mentor, forever.
  if (canActAsMentor(user)) {
    if (user.name?.trim()) redirect(homeFor(user, await profileOf(user)));
    return (
      <Step
        title="Your name"
        sentence="So students and staff see who you are."
        form={<NameStepForm defaultName={user.name ?? ""} />}
      />
    );
  }

  // Staff have nothing to register: an admin created their account with a name
  // on it, and their grants are somebody else's to give.
  if (user.role !== ROLES.STUDENT) {
    redirect(homeFor(user, await profileOf(user)));
  }

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    include: {
      enrollments: {
        include: { program: true, cohort: true },
        orderBy: { program: { name: "asc" } },
      },
    },
  });

  // No profile means nobody registered this email — they signed in with Google
  // and the app made them a PENDING account on the spot. They say which program
  // they are in; `completeOnboarding` tells that program's admins.
  if (!profile) {
    const programs = await programOptions();
    return (
      <Step
        title="Complete your registration"
        sentence="Tell us who you are and which program you're in."
        form={
          <RegistrationStepForm
            defaultName={user.name ?? ""}
            programs={toProgramOptions(programs)}
          />
        }
      />
    );
  }

  // The one to greet them by when the welcome has room for a single name.
  // Where they STUDY. A student another program has borrowed for a few hours is
  // not being welcomed to that program, and a welcome that greets somebody into
  // a visit is a welcome that has misread their record.
  const studies = studiesIn(profile.enrollments);
  const first = primaryEnrollment(studies);

  // Registered by staff, first sign-in. The program is already theirs, so the
  // only things missing are the name Google may not have supplied and the
  // handle their mentors will message them on.
  //
  // Before the approval step, not after: a reader who can still do something is
  // asked to do it before being told to wait.
  if (!user.name?.trim() || !profile.telegramUsername) {
    return (
      <Step
        eyebrow={first?.cohort?.name}
        title={`Welcome to ${enrollmentsLabel(studies, "the academy")}`}
        sentence="Confirm your name and how your mentors reach you."
        form={<DetailsStepForm defaultName={user.name ?? ""} />}
      />
    );
  }

  if (user.status === USER_STATUS.PENDING) {
    return (
      <Step
        eyebrow={enrollmentsLabel(studies, undefined)}
        title="Registration received"
        sentence="An admin will approve you shortly."
      />
    );
  }

  redirect("/student");
}
