import { isText } from "@/lib/api/v1/session-forms";
import type { EnrollmentTarget } from "@/lib/api/v1/types";

/**
 * Where to, as the website's enrolment forms send it (`resolveEnrollment`):
 * the program, and its level or cohort, which the action checks belong to it.
 * The first field that isn't text when sent is named.
 */
export function enrollmentTargetForm(body: unknown): FormData | { field: string } {
  const { program, level, cohort } = (body ?? {}) as Partial<Record<keyof EnrollmentTarget, unknown>>;
  if (!isText(program)) return { field: "program" };
  if (level !== undefined && !isText(level)) return { field: "level" };
  if (cohort !== undefined && !isText(cohort)) return { field: "cohort" };
  const form = new FormData();
  form.set("programId", program);
  if (level !== undefined) form.set("levelId", level);
  if (cohort !== undefined) form.set("cohortId", cohort);
  return form;
}
