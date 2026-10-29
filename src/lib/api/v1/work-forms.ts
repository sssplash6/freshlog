import { isText } from "@/lib/api/v1/session-forms";
import type { ApiTask, ProgramTask, TaskCreate, TaskEdit } from "@/lib/api/v1/types";
import { toDateInputValue } from "@/lib/format";
import { MAX_TASK_NOTE, MAX_TASK_TITLE } from "@/lib/student-tasks";

/**
 * A JSON body as the FormData the task actions take.
 *
 * The app writes through the actions the website uses, so what they accept and
 * refuse is the website's, in its words. They read every field as
 * `String(formData.get(name) ?? "")`: a field that is missing is an answer. So no
 * form here holds a null or an undefined, and none ever names a mentor: the
 * actor is the mentor, and the task in the address decides which one.
 *
 * What is judged here is what the actions would read as something else, or
 * refuse without naming the field: a day that does not exist, a percent that
 * is not a number, a text over its limit. The app needs the field to point at.
 */

/**
 * True for a day that exists, written `YYYY-MM-DD`.
 *
 * `parseDateField` takes that shape but rolls an impossible day over into the
 * next month (`2026-02-31` is March 3), and saves it without a word.
 */
export function isDay(value: unknown): value is string {
  if (!isText(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const made = new Date(Date.UTC(year, month - 1, day));
  return toDateInputValue(made) === value;
}

/** A title as the action reads it: whitespace collapsed. Empty and the limit are judged on that. */
const collapsed = (title: string) => title.trim().replace(/\s+/g, " ");

/** The first of the title, day and note that is not a valid value, in the contract's own words for the field. */
function badField(fields: { title?: unknown; due?: unknown; note?: unknown }): string | null {
  if (fields.title !== undefined && (!isText(fields.title) || !collapsed(fields.title) || collapsed(fields.title).length > MAX_TASK_TITLE))
    return "title";
  if (fields.due !== undefined && !isDay(fields.due)) return "due";
  if (fields.note !== undefined && fields.note !== null && (!isText(fields.note) || fields.note.trim().length > MAX_TASK_NOTE))
    return "note";
  return null;
}

/**
 * `setStudentTask`'s FormData, or the first field of the body that is not valid.
 *
 * Both ids and the title and day are required, so a body without one is refused
 * on it. Whether the student exists, and whether the reader may set them work
 * in that program, is the action's to say.
 */
export function taskCreateForm(body: unknown): FormData | { field: string } {
  const { studentProfileId, programId, title, due, note } = (body ?? {}) as Partial<Record<keyof TaskCreate, unknown>>;
  if (!isText(studentProfileId)) return { field: "studentProfileId" };
  if (!isText(programId)) return { field: "programId" };
  if (!isText(title)) return { field: "title" };
  if (!isDay(due)) return { field: "due" };
  // A task has no "clear" on its way in: no note is no note.
  if (note === null) return { field: "note" };
  const bad = badField({ title, due, note });
  if (bad) return { field: bad };

  const form = new FormData();
  form.set("studentProfileId", studentProfileId);
  form.set("programId", programId);
  form.set("title", title);
  form.set("dueOn", due);
  form.set("note", isText(note) ? note : "");
  return form;
}

/** `setProgramTask`'s form for a task for every student in `programId`, or the first field that isn't a valid value. */
export function programTaskForm(programId: string, body: unknown): FormData | { field: string } {
  const { title, due, note } = (body ?? {}) as Partial<Record<keyof ProgramTask, unknown>>;
  if (!isText(title)) return { field: "title" };
  if (!isDay(due)) return { field: "due" };
  if (note === null) return { field: "note" };
  const bad = badField({ title, due, note });
  if (bad) return { field: bad };
  const form = new FormData();
  form.set("programId", programId);
  form.set("title", title);
  form.set("dueOn", due);
  form.set("note", isText(note) ? note : "");
  return form;
}

/**
 * The edit a body asks for, or the first of its fields that isn't a valid value.
 * Only the three fields of `TaskEdit` are taken: a body cannot reach a percent,
 * a mentor or a program by naming them.
 */
export function taskEditOf(body: Record<string, unknown>): { edit: TaskEdit } | { field: string } {
  const edit: TaskEdit = {};
  if (body.title !== undefined) {
    if (!isText(body.title)) return { field: "title" };
    edit.title = body.title;
  }
  if (body.due !== undefined) {
    if (!isText(body.due)) return { field: "due" };
    edit.due = body.due;
  }
  if (body.note !== undefined) {
    if (body.note !== null && !isText(body.note)) return { field: "note" };
    edit.note = body.note;
  }
  return { edit };
}

/**
 * `updateStudentTask`'s FormData. It replaces all three fields, so each one the
 * edit leaves out is sent as the task has it now.
 *
 * The task's note reads the same to everyone who can read the task (the student
 * is shown it too), so `current` is the stored value and needs no second read.
 * `note: null` and `""` both clear it, and are sent as `""`, which the action
 * stores as none.
 */
export function taskEditForm(current: ApiTask, edit: TaskEdit): FormData | { field: string } {
  const bad = badField(edit);
  if (bad) return { field: bad };

  const form = new FormData();
  form.set("taskId", current.id);
  form.set("title", edit.title ?? current.title);
  form.set("dueOn", edit.due ?? current.due);
  form.set("note", (edit.note === undefined ? current.note : edit.note) ?? "");
  return form;
}

/**
 * `setStudentTaskProgress`'s FormData: `{ done: true }` finishes the task,
 * `{ percent }` (a whole number, 0 to 100) sets how far along it is, and
 * `{ reopen: true }` is the website's "Not finished after all".
 *
 * Anything else is refused on `percent`, an empty body above all: the action
 * reads a missing percent as 0 and would send a finished task back to the start.
 * A body that says both is refused too, so the app never has two meanings to
 * choose between.
 */
export function taskProgressForm(taskId: string, body: unknown): FormData | { field: string } {
  const { done, percent, reopen } = (body ?? {}) as { done?: unknown; percent?: unknown; reopen?: unknown };
  const form = new FormData();
  form.set("taskId", taskId);
  // The website's "Not finished after all": back to 75%, and the mentor is told.
  if (reopen === true && done === undefined && percent === undefined) {
    form.set("intent", "reopen");
    return form;
  }
  if (done === true && percent === undefined) {
    form.set("intent", "done");
    return form;
  }
  if (done === undefined && typeof percent === "number" && Number.isInteger(percent) && percent >= 0 && percent <= 100) {
    form.set("intent", "percent");
    form.set("percent", String(percent));
    return form;
  }
  return { field: "percent" };
}
