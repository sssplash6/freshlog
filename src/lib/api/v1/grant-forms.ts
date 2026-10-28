import { isText } from "@/lib/api/v1/session-forms";
import type { GrantOptions, GrantRemove, GrantRequest, GrantTransfer } from "@/lib/api/v1/types";
import { isDay } from "@/lib/api/v1/work-forms";
import { MAX_TASK_LENGTH, TASK_OTHER } from "@/lib/tasks";

/**
 * A JSON body as the FormData the grant actions take (`setMentorAllocation`,
 * `transferMentorAllocation`, `removeMentorAllocation`).
 *
 * The actions name no `field` when they refuse, so what they would refuse for
 * a value is judged here first and answered on its field: the minutes, the
 * day, the payment, the plan item, the past-hours question. What is left to
 * them is what only the ledger knows: a share over what the bank has left, a
 * transfer over what is unused, a grant that changes nothing.
 */

/** The longest note a plan item a grant makes may carry (`setMentorAllocation`). */
const MAX_TASK_NOTE = 500;
const MAX_PAID = 10_000_000;

const isWhole = (value: unknown, min: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min;
const orNullText = (value: unknown): value is string | null => value === null || isText(value);

/** The amount a body says was paid: 0 or more, at most two decimals. */
const isPaid = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_PAID && Math.round(value * 100) === value * 100;

/**
 * `setMentorAllocation`'s FormData, or the first field of the body that is
 * not one the sheet could have sent. `options` is what `GET grant-options`
 * answers this reader for this student: the program must be one of its
 * programs, the mentor one of its mentors, a plan item one of its open ones.
 */
export function grantForm(studentProfileId: string, body: Record<string, unknown>, options: GrantOptions): FormData | { field: string } {
  const { program: programId, mentor, bank, mode, minutes, deadline, amountPaid, task, includePrevious } = body as Partial<Record<keyof GrantRequest, unknown>>;
  const program = options.programs.find((p) => p.id === programId);
  if (!program) return { field: "program" };
  if (!orNullText(mentor) || mentor === undefined) return { field: "mentor" };
  if (mentor !== null && !options.mentors.some((m) => m.mentor.id === mentor)) return { field: "mentor" };
  if (bank !== undefined && typeof bank !== "boolean") return { field: "bank" };
  const toBank = bank === true;
  if (toBank && (mentor !== null || !program.bankAllowed)) return { field: "bank" };
  if (mode !== "add" && mode !== "set") return { field: "mode" };
  // A correction may set a grant to nothing; a grant gives at least a minute.
  if (!isWhole(minutes, mode === "add" ? 1 : 0)) return { field: "minutes" };
  if (!isDay(deadline)) return { field: "deadline" };
  if (program.tracksPayment ? !isPaid(amountPaid) : amountPaid !== undefined) return { field: "amountPaid" };

  const form = new FormData();
  form.set("studentProfileId", studentProfileId);
  form.set("programId", program.id);
  form.set("mentorId", mentor ?? "");
  if (toBank) form.set("bank", "1");
  form.set("mode", mode);
  form.set("minutes", String(minutes));
  form.set("deadline", deadline);
  if (program.tracksPayment) form.set("amountPaid", String(amountPaid));

  if (task !== undefined) {
    // The bank is no piece of work, and makes none.
    if (toBank || typeof task !== "object" || task === null) return { field: "task" };
    const { purpose, note, planItem } = task as { purpose?: unknown; note?: unknown; planItem?: unknown };
    if (planItem !== undefined) {
      // The action tops up an open item of that mentor's by its purpose.
      const open = options.openPlan.find((item) => item.id === planItem && item.programId === program.id && item.mentorId === mentor);
      if (!open || purpose !== undefined || note !== undefined) return { field: "task" };
      form.set("task", open.purpose);
    } else {
      if (!isText(purpose) || !purpose.trim() || purpose.trim().length > MAX_TASK_LENGTH) return { field: "task.purpose" };
      if (note !== undefined && (!isText(note) || note.trim().length > MAX_TASK_NOTE)) return { field: "task.note" };
      form.set("task", TASK_OTHER);
      form.set("taskCustom", purpose);
      if (isText(note)) form.set("taskNote", note);
    }
  }

  // Asked only of a first bank over hours given before it.
  if (toBank && program.askPast) {
    if (typeof includePrevious !== "boolean") return { field: "includePrevious" };
    form.set("includePrevious", includePrevious ? "yes" : "no");
  }
  return form;
}

/** `transferMentorAllocation`'s FormData, or the first field that is not valid. `from` null is the pool. */
export function transferForm(studentProfileId: string, body: Record<string, unknown>): FormData | { field: string } {
  const { program, from, to, minutes, moveTasks } = body as Partial<Record<keyof GrantTransfer, unknown>>;
  if (!isText(program)) return { field: "program" };
  if (from === undefined || !orNullText(from)) return { field: "from" };
  if (!isText(to) || !to) return { field: "to" };
  if (!isWhole(minutes, 1)) return { field: "minutes" };
  if (typeof moveTasks !== "boolean") return { field: "moveTasks" };
  const form = new FormData();
  form.set("studentProfileId", studentProfileId);
  form.set("programId", program);
  form.set("fromMentorId", from ?? "");
  form.set("toMentorId", to);
  form.set("minutes", String(minutes));
  if (moveTasks) form.set("moveTasks", "on");
  return form;
}

/** `removeMentorAllocation`'s FormData, or the first field that is not valid. */
export function removeForm(studentProfileId: string, body: Record<string, unknown>): FormData | { field: string } {
  const { program, mentor, bank } = body as Partial<Record<keyof GrantRemove, unknown>>;
  if (!isText(program)) return { field: "program" };
  if (mentor === undefined || !orNullText(mentor)) return { field: "mentor" };
  if (bank !== undefined && typeof bank !== "boolean") return { field: "bank" };
  if (bank === true && mentor !== null) return { field: "bank" };
  const form = new FormData();
  form.set("studentProfileId", studentProfileId);
  form.set("programId", program);
  form.set("mentorId", mentor ?? "");
  if (bank) form.set("bank", "1");
  return form;
}
