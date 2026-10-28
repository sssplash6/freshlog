import { parseNameField, parseTelegramField } from "@/lib/actions/shared";
import { isText } from "@/lib/api/v1/session-forms";
import type { OnboardingAnswer, OnboardingStep } from "@/lib/api/v1/types";

/**
 * A sign-up answer as the FormData its step's action takes
 * (`completeOnboarding`, `completeStudentProfile`, `completeMentorProfile`).
 *
 * The name and the handle are judged here by the same parsers the actions call,
 * in their words, so the app can point at the box; the program, its level and
 * its cohort need the database and stay the action's to judge.
 */
export function onboardingForm(
  step: NonNullable<OnboardingStep["step"]>,
  body: Record<string, unknown> | null
): FormData | { field: string; error: string } {
  const { name, telegram, program, level, cohort } = (body ?? {}) as Partial<Record<keyof OnboardingAnswer, unknown>>;
  const form = new FormData();

  const parsedName = parseNameField(isText(name) ? name : null, "your");
  if ("error" in parsedName) return { field: "name", error: parsedName.error };
  form.set("name", parsedName.value);
  if (step === "mentor-name") return form;

  const handle = parseTelegramField(isText(telegram) ? telegram : null);
  if ("error" in handle) return { field: "telegram", error: handle.error };
  form.set("telegramUsername", handle.value);
  if (step === "details") return form;

  form.set("programId", isText(program) ? program : "");
  form.set("levelId", isText(level) ? level : "");
  form.set("cohortId", isText(cohort) ? cohort : "");
  return form;
}
