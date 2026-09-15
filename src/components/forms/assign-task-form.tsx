"use client";

import { useState } from "react";

import { TaskPicker, type OpenTask } from "@/components/forms/task-picker";
import { Select, type SelectOption } from "@/components/select";
import { Input, Textarea } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { setMentorAllocation } from "@/lib/actions/students";
import { toDateInputValue } from "@/lib/format";

const labelClass =
  "block text-xs font-semibold uppercase tracking-[0.06em] text-muted-fg";

/**
 * The one way hours reach a student: a grant, with the mentor and task
 * optionally named on it. Time alone lands in the student's unassigned pool
 * until an admin decides who does what; naming a mentor puts them on that
 * mentor's ledger, and naming a task makes it that piece of work's budget.
 *
 * Always ADDS: these hours go on top of whatever the student already holds with
 * this mentor (or unassigned), and a named task is created — or, if one by
 * that name is already open, its budget grows. Correcting a total is the ⋮
 * menu's job on the row itself. Picking a mentor who isn't in the student's
 * program yet assigns them to it as part of the same action.
 */
export function AssignTaskForm({
  studentProfileId,
  programs,
  mentors,
  openTasksByMentor = {},
  paymentPrograms = [],
}: {
  studentProfileId: string;
  /**
   * The student's programs, as the reader may see them.
   *
   * Time is granted IN a program — that is where its deadline, its totals and
   * its admins come from — so this is asked whenever the answer is more than
   * one, and posted silently when it is one.
   */
  programs: SelectOption[];
  /** Every mentor who could take this on. */
  mentors: SelectOption[];
  /** `programId:mentorId` → the open tasks they already have with this student. */
  openTasksByMentor?: Record<string, OpenTask[]>;
  /** The programs that also record what was paid. */
  paymentPrograms?: readonly string[];
}) {
  const [, action, save] = useSaveState(setMentorAllocation);
  const [mentorId, setMentorId] = useState("");
  const [programId, setProgramId] = useState(
    programs.length === 1 ? programs[0].value : ""
  );
  const today = toDateInputValue(new Date());
  // The money fields belong to the grant, so they follow the program picked
  // rather than the student: a student in the Master's Program and in Global
  // Admissions is asked what they paid for one and not for the other.
  const showAmountPaid = paymentPrograms.includes(programId);
  const openTasks = openTasksByMentor[`${programId}:${mentorId}`] ?? [];

  return (
    // No standfirst and no heading of its own: the section this sits in is
    // already titled "Allocate time", and the paragraph under it explained
    // three optional fields that say "decide later" in their own placeholders.
    <form action={action}>
      <input type="hidden" name="studentProfileId" value={studentProfileId} />
      <input type="hidden" name="mode" value="add" />
      {programs.length === 1 && (
        <input type="hidden" name="programId" value={programs[0].value} />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {programs.length > 1 && (
          <div className="min-w-0">
            <span className={labelClass}>
              Program <span className="text-accent-ink">*</span>
            </span>
            <div className="mt-1">
              <Select
                name="programId"
                ariaLabel="Program"
                options={programs}
                placeholder="Which program is this for?"
                onChange={setProgramId}
              />
            </div>
          </div>
        )}
        <div className="min-w-0">
          <span className={labelClass}>Mentor</span>
          <div className="mt-1">
            <Select
              name="mentorId"
              ariaLabel="Mentor"
              options={mentors}
              placeholder="No one yet — decide later"
              required={false}
              onChange={setMentorId}
            />
          </div>
        </div>

        {/* Remounted per mentor: their open tasks lead the list, and a task
            picked for one mentor must never be left selected under another's.
            The "" key is the unassigned pool's own open tasks. */}
        <TaskPicker
          key={`${programId}:${mentorId}`}
          className="lg:col-span-2"
          optional
          openTasks={openTasks}
        />

      </div>

      {/* NOTE BESIDE THE FIGURES, which is the owner's own sketch: one tall box
          for what the hours are for, and the three values that decide them
          stacked down a narrow column to its right. They were six cells in one
          three-column grid, so the note — the only field anybody types a
          sentence into — was a single-line input spanning the full width while
          the numbers wrapped around it.

          The third slot in that column is PAID where the program bills per
          student, and the submit button where it does not: a program with no
          money field had an empty cell under its deadline and its own action
          orphaned below the form. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_16rem]">
        <label className="flex min-w-0 flex-col">
          <span className={labelClass}>Note</span>
          <Textarea
            name="taskNote"
            maxLength={500}
            placeholder="Optional — e.g. review the intro of each essay"
            className="mt-1 min-h-32 flex-1"
          />
        </label>

        <div className="grid content-start gap-3">
          <label className="min-w-0">
            <span className={labelClass}>
              Minutes <span className="text-accent-ink">*</span>
            </span>
            <Input
              name="minutes"
              type="number"
              min="1"
              step="1"
              required
              placeholder="180"
              className="mt-1"
            />
          </label>

          <label className="min-w-0">
            <span className={labelClass}>
              Use by <span className="text-accent-ink">*</span>
            </span>
            <Input
              name="deadline"
              type="date"
              required
              min={today}
              className="mt-1"
            />
          </label>

          {showAmountPaid ? (
            <label className="min-w-0">
              <span className={labelClass}>
                Paid for these hours ($) <span className="text-accent-ink">*</span>
              </span>
              <Input
                name="amountPaid"
                type="number"
                min="0"
                step="0.01"
                required
                placeholder="1200"
                className="mt-1"
              />
            </label>
          ) : (
            <SubmitButton className="w-full" pendingText="Allocating…">
              Allocate time
            </SubmitButton>
          )}
        </div>
      </div>

      {/* Only where Paid took the slot the button would have had. */}
      {showAmountPaid && (
        <div className="mt-3">
          <SubmitButton pendingText="Allocating…">Allocate time</SubmitButton>
        </div>
      )}
      <SaveState state={save} />
    </form>
  );
}
