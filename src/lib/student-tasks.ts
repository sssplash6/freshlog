import { ASSIGNMENT_PROGRESS } from "@/lib/constants";
import { taskStatuses, type Status, type ViewerContext } from "@/lib/status";

/**
 * The task vocabulary — the OTHER kind of task, and the reason this file is
 * not `lib/tasks.ts`.
 *
 *   agenda  `Assignment`. What the mentoring hours are FOR: an admin plans it,
 *           budgets minutes against it, and a mentor logs sessions into it.
 *           Nobody but staff has ever written to one. lib/tasks.ts.
 *   task    `StudentTask`. What the student goes away and DOES between two
 *           meetings: a title, a deadline, a note, and a percentage only they
 *           can move. No minutes, no budget, no sessions. This file.
 *
 * The two were nearly one table. What separates them is who writes: an agenda
 * item's progress is derived from hours other people deliver, and a task's is a
 * statement by the student about their own week. Sharing a row would have put a
 * student's hand on the budget an admin's grant hangs off.
 *
 * What they DO share is how far along they read as — a task borrows the agenda's
 * `TASK_NOT_STARTED / TASK_IN_PROGRESS / TASK_DONE / TASK_OVERDUE` states from
 * lib/status.ts rather than inventing a fourth progress vocabulary, so "in
 * progress" cannot mean one thing on a student's home and another on the board.
 */

export const MAX_TASK_TITLE = 100;
export const MAX_TASK_NOTE = 500;

/**
 * The percentages the control offers. Quarters, because a student on a phone
 * answers "roughly how far?" in one tap, and a slider asking for 63% is asking
 * a question nobody has the answer to.
 *
 * 100 is deliberately NOT one of them. The control's last button is Done, and a
 * row reading "100%  Done" makes the student pick between two spellings of the
 * same claim — while the two are not the same claim at all: 100 is a
 * percentage, Done is an act, stamped with the moment it happened. Done writes
 * 100 itself.
 *
 * The column takes any integer 0-100, so these can be re-cut without a
 * migration — and a row already sitting on a step that no longer exists still
 * renders, because nothing reads this list to validate.
 */
export const PERCENT_STEPS = [0, 25, 50, 75] as const;

/** Reject anything a percentage cannot be. */
export function parsePercentField(
  raw: FormDataEntryValue | null
): { value: number } | { error: string } {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    return { error: "Pick how far along you are." };
  }
  return { value: n };
}

/** Everything the progress of a task is decided from. */
export type TaskProgressInput = {
  percent: number;
  completedAt: Date | null;
};

/**
 * How far along one task is, in the agenda's own three words.
 *
 * `completedAt` outranks the percentage, and never the other way round:
 * finishing is something the student DID at a moment, and a task they marked
 * done at 80% is done. Dragging the percentage back below 100 does not undo it
 * — `reopenStudentTask` is the way back, and it clears the stamp.
 */
export function taskProgress(task: TaskProgressInput): string {
  if (task.completedAt) return ASSIGNMENT_PROGRESS.DONE;
  return task.percent > 0
    ? ASSIGNMENT_PROGRESS.IN_PROGRESS
    : ASSIGNMENT_PROGRESS.NOT_STARTED;
}

export function taskIsOpen(task: TaskProgressInput): boolean {
  return taskProgress(task) !== ASSIGNMENT_PROGRESS.DONE;
}

/**
 * Every state a task is in, in this reader's words.
 *
 * Delegated to `taskStatuses` with the two hour fields it cannot have: no
 * budget and nothing logged, so `TASK_OVER_BUDGET` can never fire, and a mentor
 * is always named, so neither can `TASK_NEEDS_MENTOR`. What is left is exactly
 * the four states a task has — and they are the agenda's own, which is the
 * point of borrowing them.
 */
export function studentTaskStatuses(
  task: {
    id: string;
    title: string;
    percent: number;
    completedAt: Date | null;
    dueOn: Date;
    mentorId: string;
  },
  viewer: ViewerContext,
  extra: { student?: { id: string; name: string }; program?: { id: string; name: string } } = {}
): Status[] {
  return taskStatuses(
    {
      id: task.id,
      purpose: task.title,
      progress: taskProgress(task),
      mentorId: task.mentorId,
      minuteLimit: null,
      loggedMinutes: 0,
      dueOn: task.dueOn,
      ...extra,
    },
    viewer
  );
}
