import { isMinutes, isOneOf, isText } from "@/lib/api/v1/session-forms";
import { isDay } from "@/lib/api/v1/work-forms";
import type { ApiPlanItem, PlanItemEdit, PlanItemProgress } from "@/lib/api/v1/types";
import { ASSIGNMENT_PROGRESS, ASSIGNMENT_PROGRESS_AUTO } from "@/lib/constants";

/**
 * A JSON body as the FormData the plan item actions take.
 *
 * `updateAssignment` and `setAssignmentProgress` are the website's, so what they
 * accept and refuse is the website's, in its words. They read every field as
 * `String(formData.get(name) ?? "")`, so a form never holds a null or an
 * undefined, and `updateAssignment` replaces the item whole: a field it isn't
 * sent resets.
 */

const orNull = (valid: (value: unknown) => boolean) => (value: unknown) => value === null || valid(value);

/**
 * What each field of an edit has to be, in the order the contract lists them:
 * the type, and for a day that it exists. Everything else (how long a purpose
 * may be, which limits are plausible) is the action's to judge, in its words.
 *
 * Typed over `PlanItemEdit`'s own keys, so a field added to the contract does
 * not compile until it has a line here.
 */
const EDIT_FIELDS: { [Field in keyof PlanItemEdit]-?: (value: unknown) => boolean } = {
  purpose: isText,
  minuteLimit: orNull(isMinutes),
  due: orNull(isDay),
  dueNote: orNull(isText),
  note: orNull(isText),
  mentor: orNull(isText),
};

/**
 * The edit a body asks for, or the first of its fields that isn't a valid value.
 *
 * Only the fields of `PlanItemEdit` are taken, so a body cannot choose a
 * progress by naming it: that moves through its own route. `mentor` is taken
 * here and judged by the route, which knows who is asking.
 */
export function planItemEditOf(body: Record<string, unknown>): { edit: PlanItemEdit } | { field: string } {
  const edit: Record<string, unknown> = {};
  for (const [field, isValid] of Object.entries(EDIT_FIELDS)) {
    const value = body[field];
    if (value === undefined) continue;
    if (!isValid(value)) return { field };
    edit[field] = value;
  }
  // Each value passed its own field's check above.
  return { edit: edit as PlanItemEdit };
}

/** What the row itself holds and an edit must not lose: the parts `current` does not show everyone. */
export type StoredPlanItem = { mentorId: string | null; progress: string; note: string | null };

/**
 * `updateAssignment`'s FormData. It replaces every field, so each one the edit
 * leaves out is sent as the item has it now.
 *
 * - The purpose is sent as typed text (`purposeCustom`) with nothing picked,
 *   which the action reads as that text, whatever the website's list holds.
 * - The note, the mentor and the progress come from `stored`, the row itself,
 *   unless the edit names a mentor. The note because a student's view of it is
 *   null and an edit filled from that would erase it. The mentor because the
 *   action replaces it too, and only an admin's edit moves it (the route says
 *   whose). The progress because the action overwrites it and only the
 *   progress route moves it, pinned or not.
 * - `null` clears a limit, a day, a due note or a note, and goes as `""`.
 *
 * A due day that is not on the calendar comes back as `{ field: "due" }`.
 */
export function planItemEditForm(
  current: ApiPlanItem,
  edit: PlanItemEdit,
  stored: StoredPlanItem
): FormData | { field: string } {
  const due = edit.due === undefined ? current.due : edit.due;
  if (due !== null && !isDay(due)) return { field: "due" };
  const minuteLimit = edit.minuteLimit === undefined ? current.minuteLimit : edit.minuteLimit;
  const form = new FormData();
  form.set("assignmentId", current.id);
  form.set("purpose", "");
  form.set("purposeCustom", edit.purpose ?? current.purpose);
  form.set("mentorId", (edit.mentor === undefined ? stored.mentorId : edit.mentor) ?? "");
  form.set("minuteLimit", minuteLimit === null ? "" : String(minuteLimit));
  form.set("dueNote", (edit.dueNote === undefined ? current.dueNote : edit.dueNote) ?? "");
  form.set("dueOn", due ?? "");
  form.set("note", (edit.note === undefined ? stored.note : edit.note) ?? "");
  form.set("progress", stored.progress);
  return form;
}

/** The three states and the release, typed against the contract so a word added to one and not the other does not compile. */
const isProgressWord = isOneOf<PlanItemProgress["progress"]>([
  ...Object.values(ASSIGNMENT_PROGRESS),
  ASSIGNMENT_PROGRESS_AUTO,
]);

/**
 * `setAssignmentProgress`'s FormData, or `{ field: "progress" }` when the body
 * does not name one of the four words, spelled as the contract does. Anything
 * else would reach the action as a state it does not know.
 */
export function planItemProgressForm(id: string, body: unknown): FormData | { field: string } {
  const progress = typeof body === "object" && body !== null ? (body as Record<string, unknown>).progress : undefined;
  if (!isProgressWord(progress)) return { field: "progress" };
  const form = new FormData();
  form.set("assignmentId", id);
  form.set("progress", progress);
  return form;
}
