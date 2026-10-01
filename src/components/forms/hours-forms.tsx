"use client";

import { useState } from "react";

import { TaskPicker, type OpenTask } from "@/components/forms/task-picker";
import { Select, type SelectOption } from "@/components/select";
import { Button } from "@/components/ui/button";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { Field, GrowingField, Input } from "@/components/ui/field";
import { RowActionGroup, RowActionMenu } from "@/components/ui/row-action-menu";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { toDateInputValue } from "@/lib/format";
import { MAX_TASK_LENGTH } from "@/lib/tasks";
import {
  deleteAssignment,
  setAssignmentProgress,
  updateAssignment,
} from "@/lib/actions/assignments";
import {
  removeMentorAllocation,
  setMentorAllocation,
  transferMentorAllocation,
} from "@/lib/actions/students";
import {
  ASSIGNMENT_PROGRESS,
  ASSIGNMENT_PROGRESS_AUTO,
  ASSIGNMENT_PROGRESS_LABELS,
} from "@/lib/constants";

/**
 * The two menus that edit a student's hours: who holds them, and what they are
 * for.
 *
 * They share a file because they share a subject and a page. An allocation
 * grants a mentor a pool of the student's time; an AGENDA item carves a budget
 * out of that pool and is what a session is logged against. The link is literal
 * — raising an allocation opens the same `TaskPicker` the agenda menu edits, so
 * the arriving hours name the work they are for — and removing an allocation
 * deletes that mentor's agenda with the student along with it. Splitting them
 * would put two ends of one write in two files.
 *
 * Nothing here touches a `StudentTask`, which is the other thing the team calls
 * a task and has no hours at all — see `lib/student-tasks.ts`.
 */

/**
 * Per-row allocation actions for one mentor — or for the unassigned pool, which
 * rides the same row shape with an empty mentorId: correct the total hours, the
 * use-by date and (for Master's) the amount paid, or remove the allocation from
 * the student entirely.
 *
 * A correction that raises the total is still a grant, so the task picker
 * appears the moment the typed hours go above what the student already holds.
 */
export function AllocationRowActions({
  studentProfileId,
  programId,
  mentorId,
  mentorLabel,
  currentMinutes,
  currentDeadline,
  openTasks = [],
  showAmountPaid = false,
  currentAmountPaid = null,
  unusedMinutes = 0,
  transferTo = [],
  bank = false,
}: {
  /** This row is the student's hour bank: no mentor, no tasks, no transfer. */
  bank?: boolean;
  studentProfileId: string;
  /** Which program's grant this row is. An allocation cannot be addressed
   *  without it: the same mentor may hold separate time with the same student
   *  in two programs, with two deadlines. */
  programId: string;
  mentorId: string;
  mentorLabel: string;
  currentMinutes: number;
  currentDeadline: string | null;
  /** This mentor's open tasks with the student, for a raise that grants hours. */
  openTasks?: OpenTask[];
  showAmountPaid?: boolean;
  currentAmountPaid?: number | null;
  /** What this row still holds unspent and in date — the most a transfer can
   *  move. Zero hides the transfer: there is nothing to hand over. */
  unusedMinutes?: number;
  /** Mentors the time may be moved to. This row's own mentor is left out. */
  transferTo?: SelectOption[];
}) {
  const [minutes, setMinutes] = useState(String(currentMinutes));
  // A raise grants hours, and hours arriving name the work they are for.
  const granting = Number(minutes) > currentMinutes;
  const [, setAction, setSave] = useSaveState(setMentorAllocation);
  const [, delAction, delSave] = useSaveState(removeMentorAllocation);

  return (
    <RowActionMenu
      trigger="dots"
      label={bank ? "Manage the hour bank" : `Manage time with ${mentorLabel}`}
      width="md"
    >
      <RowActionGroup label="Correct this allocation">
        <form action={setAction} className="space-y-3">
          <input
            type="hidden"
            name="studentProfileId"
            value={studentProfileId}
          />
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="mentorId" value={mentorId} />
          {bank && <input type="hidden" name="bank" value="1" />}
          <input type="hidden" name="mode" value="set" />

          <Field label="Total minutes">
            <Input
              name="minutes"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </Field>

          <Field label="Use by">
            <Input
              name="deadline"
              type="date"
              required
              defaultValue={currentDeadline ?? ""}
            />
          </Field>

          {showAmountPaid && (
            <Field label="Total paid ($)">
              <Input
                name="amountPaid"
                type="number"
                min="0"
                step="0.01"
                required
                defaultValue={currentAmountPaid ?? ""}
              />
            </Field>
          )}

          {granting && !bank && (
            <div className="rise-in">
              <TaskPicker compact optional openTasks={openTasks} />
              <p className="mt-1.5 text-[0.6875rem] text-muted-fg">
                Name the work and these extra hours become its budget.
              </p>
            </div>
          )}

          <SubmitButton size="sm" pendingText="Saving…">
            Save
          </SubmitButton>
        </form>
        <SaveState state={setSave} />
      </RowActionGroup>

      {!bank && unusedMinutes > 0 && transferTo.length > 0 && (
        <TransferGroup
          studentProfileId={studentProfileId}
          programId={programId}
          fromMentorId={mentorId}
          unusedMinutes={unusedMinutes}
          mentors={transferTo}
          hasOpenTasks={openTasks.length > 0}
        />
      )}

      <RowActionGroup>
        <ConfirmInline
          variant="quiet"
          action={delAction}
          values={{ studentProfileId, programId, mentorId, ...(bank ? { bank: "1" } : {}) }}
          pending={delSave.kind === "saving"}
          label={bank ? "Remove hour bank" : mentorId ? "Remove mentor" : "Remove time"}
          // Naming the consequence, because it is wider than the row: the
          // action deletes this pairing's open tasks and its allocation
          // history along with the hours. A mentor who has logged a session is
          // refused by the action itself, which is the one case this cannot
          // know from here.
          question={
            bank
              ? "The bank goes. It can only be removed while no meeting has drawn from it."
              : mentorId
                ? "Their hours and their open agenda with this student go."
                : "The unallocated hours go. Nothing is logged against them."
          }
          confirmLabel="Yes, remove"
          pendingLabel="Removing…"
        />
        <SaveState state={delSave} />
      </RowActionGroup>
    </RowActionMenu>
  );
}

/**
 * Hand this row's unused time to another mentor in the same program — the
 * student changed mentors. One write that takes from here exactly what it
 * gives there, where "grant the new one, then remember to cut the old one"
 * was two, and the second was the one that got forgotten.
 */
function TransferGroup({
  studentProfileId,
  programId,
  fromMentorId,
  unusedMinutes,
  mentors,
  hasOpenTasks,
}: {
  studentProfileId: string;
  programId: string;
  fromMentorId: string;
  unusedMinutes: number;
  mentors: SelectOption[];
  hasOpenTasks: boolean;
}) {
  const [, action, save] = useSaveState(transferMentorAllocation);

  return (
    <RowActionGroup label="Move time to another mentor">
      <form action={action} className="space-y-3">
        <input type="hidden" name="studentProfileId" value={studentProfileId} />
        <input type="hidden" name="programId" value={programId} />
        <input type="hidden" name="fromMentorId" value={fromMentorId} />

        <Field label="To">
          <Select
            name="toMentorId"
            options={mentors}
            placeholder="Pick a mentor"
            ariaLabel="Mentor to move the time to"
          />
        </Field>

        <Field label={`Minutes to move (${unusedMinutes} unused)`}>
          <Input
            name="minutes"
            type="number"
            inputMode="numeric"
            min="1"
            max={unusedMinutes}
            step="1"
            required
            defaultValue={unusedMinutes}
          />
        </Field>

        {hasOpenTasks && (
          <label className="flex items-center gap-2 text-xs text-ink">
            <input type="checkbox" name="moveTasks" defaultChecked />
            Move their open tasks too
          </label>
        )}

        <p className="text-[0.6875rem] text-muted-fg">
          Logged time stays with the current mentor. The student&apos;s total
          doesn&apos;t change.
        </p>

        <SubmitButton size="sm" pendingText="Moving…">
          Move time
        </SubmitButton>
      </form>
      <SaveState state={save} />
    </RowActionGroup>
  );
}

/**
 * Inline editor for the one allocation figure admins act on most often. The
 * deadline and payment stay hidden here because this affordance is specifically
 * for changing the total; the row menu remains the place for the less common
 * metadata edits.
 */
export function AllocationMinutesEditor({
  studentProfileId,
  programId,
  mentorId,
  currentMinutes,
  currentDeadline,
  currentAmountPaid = null,
  showAmountPaid = false,
  bank = false,
}: {
  bank?: boolean;
  studentProfileId: string;
  programId: string;
  mentorId: string;
  currentMinutes: number;
  currentDeadline: string | null;
  currentAmountPaid?: number | null;
  showAmountPaid?: boolean;
}) {
  const [, setAction, save] = useSaveState(setMentorAllocation);
  const [minutes, setMinutes] = useState(String(currentMinutes));

  return (
    <RowActionMenu
      trigger="pencil"
      label="Edit total allocated time"
      width="sm"
    >
      <RowActionGroup label="Total allocated time">
        <form action={setAction} className="space-y-3">
          <input type="hidden" name="studentProfileId" value={studentProfileId} />
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="mentorId" value={mentorId} />
          {bank && <input type="hidden" name="bank" value="1" />}
          <input type="hidden" name="mode" value="set" />
          <input type="hidden" name="deadline" value={currentDeadline ?? ""} />
          {showAmountPaid && (
            <input
              type="hidden"
              name="amountPaid"
              value={currentAmountPaid ?? "0"}
            />
          )}
          <Field label="Total minutes">
            <Input
              name="minutes"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </Field>
          <SubmitButton size="sm" pendingText="Saving…">
            Save
          </SubmitButton>
        </form>
        <SaveState state={save} />
      </RowActionGroup>
    </RowActionMenu>
  );
}

const PROGRESS_ORDER = [
  ASSIGNMENT_PROGRESS.NOT_STARTED,
  ASSIGNMENT_PROGRESS.IN_PROGRESS,
  ASSIGNMENT_PROGRESS.DONE,
];

type TaskFields = {
  id: string;
  purpose: string;
  /** Null = no mentor chosen yet; the edit below is where one is picked. */
  mentorId: string | null;
  minuteLimit: number | null;
  dueNote: string | null;
  dueOn: Date | null;
  note: string | null;
  progress: string;
  /** True when an admin pinned the progress, so hours no longer move it. */
  progressManual: boolean;
};

/**
 * Per-row agenda controls behind a ⋮ menu: move it through its progress states
 * in one click, edit any field, or remove the row. Progress leads because it is
 * the thing that actually changes week to week — opening a whole form to tick
 * something off would be the wrong shape for it.
 */
export function TaskRowActions({
  task,
  mentors,
  canDelete = false,
}: {
  task: TaskFields;
  mentors: SelectOption[];
  /**
   * Admins only. A mentor may correct their own task — the budget, the
   * deadline, the note, the progress — because they are the person who finds
   * out it is wrong. Removing work an admin planned is a decision about the
   * plan, not a correction to it, and `deleteAssignment` refuses it server-side
   * whatever this prop says.
   */
  canDelete?: boolean;
}) {
  return (
    <RowActionMenu trigger="dots" label={`Manage "${task.purpose}"`} width="md">
      <TaskPanel task={task} mentors={mentors} canDelete={canDelete} />
    </RowActionMenu>
  );
}

/**
 * The panel's own state, held by the panel rather than the row.
 *
 * This menu has two faces, and which one it opens on matters: it must be
 * Progress, every time. `assignment-row-actions` held that flag next to `open`
 * and cleared it by hand in a `close()` that also cleared the delete confirm —
 * three pieces of state one gesture had to keep in step, which is the shape all
 * four of these files drifted out of. Held inside the panel, which exists only
 * while the menu is open, it resets on close because the component holding it
 * is gone.
 */
function TaskPanel({
  task,
  mentors,
  canDelete,
}: {
  task: TaskFields;
  mentors: SelectOption[];
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [, progressAction, progressSave] = useSaveState(setAssignmentProgress);
  const progressPending = progressSave.kind === "saving";
  const [, editAction, editSave] = useSaveState(updateAssignment);
  const [, delAction, delSave] = useSaveState(deleteAssignment);

  if (editing) {
    return (
      <RowActionGroup label="Edit this agenda item">
        <form action={editAction} className="space-y-3">
          <input type="hidden" name="assignmentId" value={task.id} />
          <input type="hidden" name="progress" value={task.progress} />

          <Field label="Agenda item">
            <GrowingField
              name="purpose"
              required
              maxLength={MAX_TASK_LENGTH}
              defaultValue={task.purpose}
            />
          </Field>

          {/* Not a `Field`: `Select` is a combobox built from buttons, and a
              <label> wrapping one has nothing to label. Its own `ariaLabel`
              names it instead. */}
          <div>
            <span className="block text-sm font-medium text-ink">Mentor</span>
            <div className="mt-1.5">
              <Select
                name="mentorId"
                ariaLabel="Mentor"
                options={mentors}
                defaultValue={task.mentorId ?? ""}
                placeholder="No one yet"
                required={false}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Field label="Minute limit" className="min-w-0 flex-1">
              <Input
                name="minuteLimit"
                type="number"
                min="0"
                step="1"
                defaultValue={task.minuteLimit ?? ""}
              />
            </Field>
            {/* The half a clock can read. Only this one can make a task
                overdue, which is why it is a date field and not more prose. */}
            <Field label="Due date" className="min-w-0 flex-1">
              <Input
                name="dueOn"
                type="date"
                defaultValue={task.dueOn ? toDateInputValue(task.dueOn) : ""}
              />
            </Field>
          </div>

          {/* And the half a person writes. The sheet this came from holds
              "March-May" as often as "August 7", and a note that cannot be
              parsed is still the truest thing anybody knows about the date. */}
          <Field label="Due, in words">
            <Input
              name="dueNote"
              type="text"
              maxLength={60}
              placeholder="March-May"
              defaultValue={task.dueNote ?? ""}
            />
          </Field>

          <Field label="Note">
            <GrowingField
              name="note"
              maxLength={500}
              placeholder="Anything the state can't say"
              defaultValue={task.note ?? ""}
            />
          </Field>

          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              Save
            </SubmitButton>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
        <SaveState state={editSave} />
      </RowActionGroup>
    );
  }

  return (
    <>
      <RowActionGroup label="Progress">
        <p className="mb-2 text-xs text-muted-fg">
          {task.progressManual
            ? "Set by hand, so logged time no longer moves it."
            : "Following the logged time. Setting it here pins it."}
        </p>
        <form
          action={progressAction}
          aria-busy={progressPending}
          className="flex flex-wrap gap-1.5"
        >
          <input type="hidden" name="assignmentId" value={task.id} />
          {PROGRESS_ORDER.map((p) => {
            // "Current" only disables when pinned there: on an automatic task,
            // clicking its present state is how you pin it.
            const current = p === task.progress && task.progressManual;
            return (
              <button
                key={p}
                type="submit"
                name="progress"
                value={p}
                disabled={progressPending || current}
                aria-current={current}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-default ${
                  current
                    ? "bg-brand text-on-brand"
                    : "border border-line text-ink hover:border-brand hover:text-brand disabled:opacity-50"
                }`}
              >
                {ASSIGNMENT_PROGRESS_LABELS[p]}
              </button>
            );
          })}
          {task.progressManual && (
            <button
              type="submit"
              name="progress"
              value={ASSIGNMENT_PROGRESS_AUTO}
              disabled={progressPending}
              className="rounded-lg border border-dashed border-line px-2.5 py-1.5 text-xs font-medium text-muted-fg transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
            >
              Follow hours
            </button>
          )}
        </form>
        <SaveState state={progressSave} />
      </RowActionGroup>

      {/* One band, two quiet actions stacked. They were a `justify-between`
          row until the confirm opened inside it and pushed a question and two
          buttons into the same 264px line as "Edit". */}
      <RowActionGroup>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex min-h-10 items-center text-xs font-medium text-brand transition-colors hover:underline"
        >
          Edit this agenda item
        </button>
        {canDelete && (
        <ConfirmInline
          variant="quiet"
          action={delAction}
          values={{ assignmentId: task.id }}
          pending={delSave.kind === "saving"}
          label="Remove this agenda item"
          // The old confirm asked nothing — it went from "Remove" straight to
          // "Yes, remove", which is a two-step confirm with the informative
          // step left out. This is the fact a reader needs: the hours logged
          // against it are not going anywhere.
          question="Sessions already logged against it are kept."
          confirmLabel="Yes, remove"
          pendingLabel="Removing…"
        />
        )}
        {canDelete && <SaveState state={delSave} />}
      </RowActionGroup>
    </>
  );
}
