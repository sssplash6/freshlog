"use client";

import { useState } from "react";

import { PlusIcon } from "@/components/icons";
import { Select, type SelectOption } from "@/components/select";
import { Labelled } from "@/components/forms/labelled";
import { Button, LinkButton } from "@/components/ui/button";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { DateField } from "@/components/ui/date-field";
import { Field, GrowingField } from "@/components/ui/field";
import { RowActionGroup, RowActionMenu } from "@/components/ui/row-action-menu";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { toDateInputValue } from "@/lib/format";
import {
  deleteStudentTask,
  setProgramTask,
  setStudentTask,
  setStudentTaskProgress,
  updateStudentTask,
} from "@/lib/actions/student-tasks";
import { MAX_TASK_NOTE, MAX_TASK_TITLE, PERCENT_STEPS } from "@/lib/student-tasks";
import { programToday } from "@/lib/when";

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
 * Set a student a task.
 *
 * Closed, it is a button at the foot of the Tasks group, under the list it
 * adds to. It used to be a floating "+" pinned to the column's corner, and
 * then a full-width row (DESIGN.md W4: a trigger hugs its label).
 *
 * Open, it expands in place of that row rather than in a dialog: what it does
 * is visible without being explained, and the list it adds to stays readable
 * while it is filled in.
 */
export function SetStudentTaskForm({
  studentProfileId,
  programs,
}: {
  studentProfileId: string;
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
  const today = programToday();

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
      <div className="border-t border-line px-1 py-1 sm:px-2">
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <PlusIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          Set a task
        </Button>
        {/* The last result survives the form closing, so a mentor who submits
            and collapses it still sees that it worked. */}
        <SaveState state={save} className="px-4 has-[span]:pb-2 sm:px-5" />
      </div>
    );
  }

  return (
    // In place of the row that opened it, hairlined like any other row.
    <form
      action={action}
      className="rise-in space-y-3 border-t border-line px-4 py-2 sm:px-5"
    >
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
          placeholder="e.g. Rewrite paragraph two"
        />
      </Field>

      <div className="flex flex-wrap items-end gap-3">
        <Labelled label="Due" required className="w-full sm:w-48">
          <DateField name="dueOn" label="Due" required min={today} />
        </Labelled>
        {programs.length > 1 && (
          <Labelled label="Program" required className="w-full sm:w-80">
            <Select name="programId" ariaLabel="Program" options={programs} />
          </Labelled>
        )}
      </div>

      <Field label="Notes">
        <GrowingField name="note" maxLength={MAX_TASK_NOTE} />
      </Field>

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

/**
 * Set one task for every student in a program — the header's "Set a student
 * task", which opens this above the roster.
 *
 * The same three fields as one student's, and no list of names: by the admins'
 * own decision it goes to everyone the program holds, exchange visitors too,
 * so a list to untick would be a control nobody is meant to use. The count is
 * on the button, so what one press will do is said before it is pressed.
 */
export function ProgramTaskForm({
  programId,
  students,
  closeHref,
}: {
  programId: string;
  /** Unused since the line naming it went; kept so callers need not change. */
  programName?: string;
  /** Approved students, which is who the action sets it for. */
  students: number;
  /** The roster without the form open. */
  closeHref: string;
}) {
  const [state, action, save] = useSaveState(setProgramTask);
  const [open, setOpen] = useState(true);
  const today = programToday();
  const everyone = students === 1 ? "1 student" : `all ${students} students`;

  // Collapse once it is set, as one student's form does, so the filled-in
  // fields cannot be sent to every student a second time.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }

  if (!open) return <SaveState state={save} className="px-1" />;
  if (students === 0) {
    return <p className="px-1 text-sm text-muted-fg">No approved students yet.</p>;
  }

  return (
    <form action={action} className="rise-in space-y-3 rounded-xl bg-surface p-4 shadow-sm sm:p-5">
      <input type="hidden" name="programId" value={programId} />
      <h2 className="text-title font-semibold tracking-[-0.01em] text-ink">
        A task for {everyone}
      </h2>

      <Field label="Task" required>
        <GrowingField
          name="title"
          required
          autoFocus
          maxLength={MAX_TASK_TITLE}
          placeholder="e.g. Activities list"
        />
      </Field>

      <Labelled label="Due" required>
        <DateField name="dueOn" label="Due" required min={today} />
      </Labelled>

      <Field label="Notes">
        <GrowingField name="note" maxLength={MAX_TASK_NOTE} />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingText="Setting…">
          Set for {everyone}
        </SubmitButton>
        <LinkButton href={closeHref} variant="ghost" size="md">
          Cancel
        </LinkButton>
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

          <Labelled label="Due">
            <DateField
              name="dueOn"
              label="Due"
              required
              defaultValue={toDateInputValue(task.dueOn)}
            />
          </Labelled>

          <Field label="Notes">
            <GrowingField name="note" maxLength={MAX_TASK_NOTE} defaultValue={task.note ?? ""} />
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
            label="Withdraw task"
            question="Withdraw this task?"
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
 * Done is the last segment and is NOT a 100% step — see `PERCENT_STEPS`. It
 * reads as the end of the track rather than as a sixth quarter, which is what
 * keeps "100%" and "Done" from being two spellings of one tap.
 */
export function TaskProgressControl({
  taskId,
  percent,
  done,
  mine = true,
}: {
  taskId: string;
  percent: number;
  done: boolean;
  /** False on the mentor's and the admin's copy: it is not their work. */
  mine?: boolean;
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
          className="inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-medium text-brand transition-colors hover:bg-brand-soft disabled:opacity-50"
        >
          Reopen
        </button>
        <SaveState state={save} />
      </form>
    );
  }

  return (
    // The question is on the form rather than above it: five buttons reading
    // 0% 25% 50% 75% Done do not need a sentence saying they are a percentage,
    // and a screen reader still hears one.
    <form
      action={action}
      aria-busy={pending}
      aria-label={mine ? "How far along you are" : "How far along they are"}
    >
      <input type="hidden" name="taskId" value={taskId} />
      {/* The look of the app's segmented control — grey track, white thumb
          on the current step — because it IS one. It stays a row of submit
          buttons rather than a `SegmentedRadio`: each tap is the save, and
          radios would need a Save button to mean anything.

          ONE control, Done included. Done used to sit outside the track as a
          second, differently shaped button, so the row read as two controls
          in two styles answering one question. It is the last segment now,
          set apart by its brand colour and tick rather than by a gap. Every
          segment is 44px tall at every width (DESIGN.md: segments are 44px,
          even in a dense card) — at 32px on a laptop and 40px on a phone they
          were the smallest targets on the student's home. */}
      <div className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-fill p-0.5">
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
              className={`inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-xs tabular-nums transition-colors disabled:cursor-default ${
                current
                  ? "bg-surface font-semibold text-ink shadow-sm"
                  : "font-medium text-muted-fg hover:text-ink disabled:opacity-50"
              }`}
            >
              {step === 0 ? "Incomplete" : `${step}%`}
            </button>
          );
        })}
        <button
          type="submit"
          name="intent"
          value="done"
          disabled={pending}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-3 text-xs font-semibold text-brand transition-colors hover:bg-fill-strong disabled:opacity-50"
        >
          Done
        </button>
      </div>
      <SaveState state={save} />
    </form>
  );
}
