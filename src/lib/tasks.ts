import { TASK_PRESETS } from "../../config/app-config";

/**
 * The AGENDA vocabulary, shared by the client pickers and the server actions.
 *
 * An agenda item is what hours are FOR. An admin names one whenever they grant
 * hours (config/app-config.ts holds the preset list, and anything can be typed
 * in its place), which creates the student's piece of work with that grant as
 * its hour budget. The mentor then logs every session against one of the open
 * items they hold for that student, so planned hours and delivered hours line
 * up without anyone reconciling two lists by hand.
 *
 * The model calls these `Assignment` rows — see prisma/schema.prisma. The UI
 * called them "tasks" until 14 September 2026, when mentors got the ability to
 * set students actual tasks (`StudentTask`); two things called a task on one
 * screen is one too many, so the hour plan took the name it always was. The
 * identifiers keep their history. `lib/student-tasks.ts` holds the other half.
 */

export { TASK_PRESETS };

/** What the picker submits for "none of these — I'll type it". */
export const TASK_OTHER = "__other__";

export const MAX_TASK_LENGTH = 200;

/**
 * Read a task out of a submitted form: the picked preset (or existing task), or
 * whatever was typed into the box the picker reveals for anything else.
 */
export function parseTaskField(
  raw: FormDataEntryValue | null,
  rawCustom: FormDataEntryValue | null
): { value: string } | { error: string } {
  const parsed = parseOptionalTaskField(raw, rawCustom);
  if ("error" in parsed) return parsed;
  if (!parsed.value) {
    return {
      error:
        "Say what these hours are for — pick one from the list or type your own.",
    };
  }
  return { value: parsed.value };
}

/**
 * Same field, but a blank one is fine: hours can be allocated before the work
 * they're for has a name. Null means nothing was named.
 */
export function parseOptionalTaskField(
  raw: FormDataEntryValue | null,
  rawCustom: FormDataEntryValue | null
): { value: string | null } | { error: string } {
  const picked = String(raw ?? "").trim();
  const typed = String(rawCustom ?? "").trim();
  const value = !picked || picked === TASK_OTHER ? typed : picked;

  if (value.length > MAX_TASK_LENGTH) {
    return { error: `Keep it under ${MAX_TASK_LENGTH} characters.` };
  }
  return { value: value || null };
}
