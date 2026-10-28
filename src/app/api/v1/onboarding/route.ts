import { completeMentorProfile } from "@/lib/actions/mentors";
import { completeOnboarding, completeStudentProfile } from "@/lib/actions/students";
import { onField } from "@/lib/api/v1/account-forms";
import { bodyOf } from "@/lib/api/v1/body";
import { onboardingFor } from "@/lib/api/v1/onboarding";
import { onboardingForm } from "@/lib/api/v1/onboarding-forms";
import { fromRedirectingAction, ok, refused, signInAgain } from "@/lib/api/v1/respond";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Sign-up: the one form this person has left (`onboardingFor`). It answers an
 * account that isn't active yet, which is who it is for: a student nobody has
 * approved fills it in before they wait.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  return ok(await onboardingFor(user));
}

/**
 * The answer to that form. The step is asked again here, never read from the
 * body, and the one action its form calls on the website does the work; each
 * redirects home when it is done, which is the success. A new student's
 * program admins are told that an approval is waiting.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  const { step } = await onboardingFor(user);
  if (!step) return refused("Nothing left to fill in.", 400);
  const form = onboardingForm(step, await bodyOf(request));
  if (!(form instanceof FormData)) return refused(form.error, 400, { field: form.field });
  switch (step) {
    case "register":
      // What is left for the action to refuse is the program, its level or its cohort.
      return fromRedirectingAction(async () => onField(await completeOnboarding(null, form), "program"));
    case "details":
      return fromRedirectingAction(() => completeStudentProfile(null, form));
    case "mentor-name":
      return fromRedirectingAction(() => completeMentorProfile(null, form));
  }
}
