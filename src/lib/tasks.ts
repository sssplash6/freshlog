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

/**
 * What the Agenda picker submits for the student's HOUR BANK. Not a piece of
 * work: it grants no task, names no mentor, and is drawn by every meeting.
 */
export const TASK_BANK = "__bank__";

/** What the picker submits for "none of these — I'll type it". */
export const TASK_OTHER = "__other__";

/**
 * What the session log's agenda picker submits for a NAME rather than an item
 * already on the agenda: `new:Supplemental Essays`. Ids are cuids, which never
 * hold a colon, so the two cannot be mistaken for each other.
 */
export const NEW_AGENDA_PREFIX = "new:";

/**
 * 100, down from 200.
 *
 * An agenda item is a NAME — "Main essay", "Recommendation letters" — and it is
 * read inside a session row beside a date, a person and a figure. At 200 it was
 * long enough to be a sentence, and one such row wrapped to three lines in a
 * half-width column and pushed every other row down with it. Nothing in the
 * database was over 52 characters when this was cut, so it takes nothing away
 * from what anybody has actually written.
 */
export const MAX_TASK_LENGTH = 100;

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

/**
 * The agenda item a session log NAMES instead of picking: a preset
 * (`new:<name>`) or whatever was typed under "Something else…". Null when the
 * picker holds an existing item's id, or nothing.
 */
export function parseNewAgendaField(
  raw: FormDataEntryValue | null,
  rawName: FormDataEntryValue | null
): { name: string } | { error: string } | null {
  const picked = String(raw ?? "").trim();
  const name =
    picked === TASK_OTHER
      ? String(rawName ?? "").trim()
      : picked.startsWith(NEW_AGENDA_PREFIX)
        ? picked.slice(NEW_AGENDA_PREFIX.length).trim()
        : null;
  if (name === null) return null;
  if (!name) return { error: "Name the agenda item, or pick None." };
  if (name.length > MAX_TASK_LENGTH) {
    return { error: `Keep it under ${MAX_TASK_LENGTH} characters.` };
  }
  return { name };
}
