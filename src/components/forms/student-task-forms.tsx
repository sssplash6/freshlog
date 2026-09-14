"use client";

import { useState } from "react";

import { Select, type SelectOption } from "@/components/select";
import { Button } from "@/components/ui/button";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { Field, GrowingField, Input } from "@/components/ui/field";
import { RowActionGroup, RowActionMenu } from "@/components/ui/row-action-menu";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { toDateInputValue } from "@/lib/format";
import {
  deleteStudentTask,
  setStudentTask,
  setStudentTaskProgress,
  updateStudentTask,
} from "@/lib/actions/student-tasks";
import { MAX_TASK_NOTE, MAX_TASK_TITLE, PERCENT_STEPS } from "@/lib/student-tasks";

/**
 * The three controls a task has, and they belong to two different people.
 *
 * The mentor sets one and corrects it: `SetStudentTaskForm` and
 * `StudentTaskRowActions`. The student moves it: `TaskProgressControl`, which
 * is the only write in this app a student makes to a row somebody else created,
 * and the reason a task is a separate table from the agenda at all.
 *
 * Three fields on the way in, and no more. Title, deadline, note is what a
 * mentor actually says at the end of a meeting — "rewrite the second paragraph,
 * by Thursday, keep it under 300 words" — and every extra field offered here
 * would be one more reason to write the task into Telegram instead.
 */

/**
 * Set a student a task. Expands in place above the list it adds to, like
 * `ScheduleInterviewForm`: what it does is visible without being explained, and
 * the list stays readable while it is filled in.
 */
export function SetStudentTaskForm({
  studentProfileId,
  studentName,
  programs,
}: {
  studentProfileId: string;
  studentName: string;
  /**
   * The programs this reader may set work in — the student's enrollments
   * narrowed to the ones the reader works in or administers. Asked when there
   * is more than one and posted silently when there is one, because a task
   * belongs to a program the way every other row in the ledger does.
   */
  programs: SelectOption[];
}) {
  const [state, action, save] = useSaveState(setStudentTask);
  const [open, setOpen] = useState(false);
  const today = toDateInputValue(new Date());

  // Collapse once the task is actually set, so the filled-in fields can't be
  // submitted a second time by a mentor who thinks the first didn't take.
  // Adjusted during render rather than in an effect — this is state reacting to
  // new state, which React handles in the same pass instead of a second one.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }

  if (!open) {
    return (
      <div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Set a task
        </Button>
        {/* The last result survives the form closing, so a mentor who submits
            and collapses it still sees that it worked. */}
        <SaveState state={save} />
      </div>
    );
  }

  return (
    <form action={action} className="rise-in space-y-3">
      <input type="hidden" name="studentProfileId" value={studentProfileId} />
      {programs.length === 1 && (
        <input type="hidden" name="programId" value={programs[0].value} />
      )}

      <Field label="Task" required>
        <GrowingField
          name="title"
          required
          autoFocus
          maxLength={MAX_TASK_TITLE}
          placeholder="Rewrite the second paragraph of the personal statement"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Deadline" required>
          <Input name="dueOn" type="date" required min={today} />
        </Field>
        {programs.length > 1 && (
          // Not a `Field`: `Select` is a combobox built from buttons, and a
          // <label> wrapping one has nothing to label.
          <div className="min-w-0">
            <span className="block text-sm font-medium text-ink">
              Program <span className="text-accent-ink">*</span>
            </span>
            <div className="mt-1.5">
              <Select
                name="programId"
                ariaLabel="Program"
                options={programs}
                placeholder="Which program is this for?"
              />
            </div>
          </div>
        )}
      </div>

      <Field label="Notes" hint="Optional. What good looks like, or where to start.">
        <GrowingField
          name="note"
          maxLength={MAX_TASK_NOTE}
          placeholder="Keep it under 300 words, and lead with the moment rather than the lesson."
        />
      </Field>

      <p className="text-xs text-muted-fg">
        {studentName} sees this on their home page and says how far along they
        are. No hours are charged — a task is work they do on their own.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingText="Setting…">Set the task</SubmitButton>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <SaveState state={save} />
    </form>
  );
}

type TaskFields = {
  id: string;
  title: string;
  note: string | null;
  dueOn: Date;
};

/**
 * Correct or withdraw a task — the ⋮ menu on the row, for the mentor who set it
 * and the admins of its program.
 *
 * A pencil rather than dots would be the wrong shape: there are two things in
 * here and one of them is destructive.
 */
export function StudentTaskRowActions({
  task,
  canDelete = true,
}: {
  task: TaskFields;
  canDelete?: boolean;
}) {
  return (
    <RowActionMenu trigger="dots" label={`Manage "${task.title}"`} width="md">
      <TaskPanel task={task} canDelete={canDelete} />
    </RowActionMenu>
  );
}

function TaskPanel({ task, canDelete }: { task: TaskFields; canDelete: boolean }) {
  const [, editAction, editSave] = useSaveState(updateStudentTask);
  const [, delAction, delSave] = useSaveState(deleteStudentTask);

  return (
    <>
      <RowActionGroup label="Edit this task">
        <form action={editAction} className="space-y-3">
          <input type="hidden" name="taskId" value={task.id} />

          <Field label="Task">
            <GrowingField
              name="title"
              required
              maxLength={MAX_TASK_TITLE}
              defaultValue={task.title}
            />
          </Field>

          <Field label="Deadline">
            <Input
              name="dueOn"
              type="date"
              required
              defaultValue={toDateInputValue(task.dueOn)}
            />
          </Field>

          <Field label="Notes">
            <GrowingField
              name="note"
              maxLength={MAX_TASK_NOTE}
              placeholder="What good looks like, or where to start"
              defaultValue={task.note ?? ""}
            />
          </Field>

          <SubmitButton size="sm" pendingText="Saving…">
            Save
          </SubmitButton>
        </form>
        <SaveState state={editSave} />
      </RowActionGroup>

      {canDelete && (
        <RowActionGroup>
          <ConfirmInline
            variant="quiet"
            action={delAction}
            values={{ taskId: task.id }}
            pending={delSave.kind === "saving"}
            label="Withdraw this task"
            // Nothing is at stake — no hours were budgeted against it and no
            // session was logged into it. What the reader needs to know is that
            // the student finds out, rather than watching a row disappear.
            question="It leaves their list, and they are told it has."
            confirmLabel="Yes, withdraw"
            pendingLabel="Withdrawing…"
          />
          <SaveState state={delSave} />
        </RowActionGroup>
      )}
    </>
  );
}

/**
 * How far along the student says they are — the one write on a task that is
 * theirs.
 *
 * One tap per answer, and no Save button. A slider asking for 63% asks a
 * question nobody has an answer to, and a form with a submit turns "I've
 * started" into a three-step errand somebody does once and then stops doing.
 * Every button is its own submit, so the whole control is one `<form>` and the
 * value rides on the button that was pressed.
 *
 * Done is the last button and is NOT a 100% step — see `PERCENT_STEPS`. It
 * reads as the end of the row rather than as a sixth quarter, which is what
 * keeps "100%" and "Done" from being two spellings of one tap.
 */
export function TaskProgressControl({
  taskId,
  percent,
  done,
}: {
  taskId: string;
  percent: number;
  done: boolean;
}) {
  const [, action, save] = useSaveState(setStudentTaskProgress);
  const pending = save.kind === "saving";

  if (done) {
    return (
      <form action={action} aria-busy={pending}>
        <input type="hidden" name="taskId" value={taskId} />
        <button
          type="submit"
          name="intent"
          value="reopen"
          disabled={pending}
          className="inline-flex min-h-8 items-center rounded-lg border border-dashed border-line px-2.5 text-xs font-medium text-muted-fg transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
        >
          Not finished after all
        </button>
        <SaveState state={save} />
      </form>
    );
  }

  return (
    <form action={action} aria-busy={pending}>
      <input type="hidden" name="taskId" value={taskId} />
      <span className="mb-1.5 block text-xs text-muted-fg">
        How far along are you?
      </span>
      <div className="flex flex-wrap gap-1.5">
        {PERCENT_STEPS.map((step) => {
          const current = step === percent;
          return (
            <button
              key={step}
              type="submit"
              name="percent"
              value={step}
              disabled={pending || current}
              aria-current={current}
              className={`min-h-8 rounded-lg px-2.5 text-xs font-medium tabular-nums transition-colors disabled:cursor-default ${
                current
                  ? "bg-brand text-on-brand"
                  : "border border-line text-ink hover:border-brand hover:text-brand disabled:opacity-50"
              }`}
            >
              {step}%
            </button>
          );
        })}
        {/* Apart from the quarters, and never filled like the selected one:
            the steps say where you are, this one ends the row. */}
        <button
          type="submit"
          name="intent"
          value="done"
          disabled={pending}
          className="ml-1 inline-flex min-h-8 items-center gap-1 rounded-lg border border-brand/40 bg-brand-soft px-2.5 text-xs font-semibold text-brand transition-colors hover:border-brand disabled:opacity-50"
        >
          <span aria-hidden="true">✓</span> Done
        </button>
      </div>
      <SaveState state={save} />
    </form>
  );
}
