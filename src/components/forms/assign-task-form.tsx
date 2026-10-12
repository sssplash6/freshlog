"use client";

import { useState } from "react";

import { TaskPicker, type OpenTask } from "@/components/forms/task-picker";
import { Select, type SelectOption } from "@/components/select";
import { Labelled } from "@/components/forms/labelled";
import { Field, GrowingField, Input } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { setMentorAllocation } from "@/lib/actions/students";
import { formatDuration } from "@/lib/format";
import { TASK_BANK } from "@/lib/tasks";
import { RequiredMark } from "@/components/ui/required-mark";

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
  bankPrograms = [],
  bankedPrograms = [],
  pastByProgram = {},
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
  /**
   * The programs where "Hour bank" is on the Agenda list — those with a bank
   * AND where the reader is an admin, who alone may change one.
   */
  bankPrograms?: readonly string[];
  /** The programs where this student already holds a bank: topped up, not created. */
  bankedPrograms?: readonly string[];
  /** Per program: what the student was allocated and has logged before any bank. */
  pastByProgram?: Record<string, { allocated: number; logged: number }>;
}) {
  const [, action, save] = useSaveState(setMentorAllocation);
  const [mentorId, setMentorId] = useState("");
  const [programId, setProgramId] = useState(
    programs.length === 1 ? programs[0].value : ""
  );
  // The money fields belong to the grant, so they follow the program picked
  // rather than the student: a student in the Master's Program and in Global
  // Admissions is asked what they paid for one and not for the other.
  const [agenda, setAgenda] = useState("");
  // The bank is picked as the agenda, and takes the mentor, the note and the
  // money with it: it is one balance for every mentor, and nobody is asked what
  // was paid for it.
  //
  // Once the student HOLDS a bank in this program it is the only balance there:
  // the action refuses a mentor's grant beside it, because meetings draw the
  // bank and the grant would sit unspent. So the form stops offering one. With
  // no mentor and no agenda left to pick it is the bank's top-up, and an admin
  // who came to give a mentor time is told why there is no mentor to name,
  // before typing a figure, not after.
  const banked = bankedPrograms.includes(programId) && bankPrograms.includes(programId);
  const isBank = banked || (agenda === TASK_BANK && bankPrograms.includes(programId));
  const showAmountPaid = !isBank && paymentPrograms.includes(programId);
  const openTasks = openTasksByMentor[`${programId}:${mentorId}`] ?? [];

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="studentProfileId" value={studentProfileId} />
      <input type="hidden" name="mode" value="add" />
      {programs.length === 1 && (
        <input type="hidden" name="programId" value={programs[0].value} />
      )}
      {banked && <input type="hidden" name="bank" value="1" />}

      {/* Hidden when empty — a banked student in one program has no program
          or mentor to pick. */}
      <div className="grid gap-3 empty:hidden sm:grid-cols-2">
        {programs.length > 1 && (
          <Labelled label="Program" required>
            <Select
              name="programId"
              ariaLabel="Program"
              options={programs}
              onChange={setProgramId}
            />
          </Labelled>
        )}
        {!isBank && (
          <Labelled label="Mentor">
            <Select
              name="mentorId"
              ariaLabel="Mentor"
              options={mentors}
              placeholder="None"
              required={false}
              onChange={setMentorId}
            />
          </Labelled>
        )}
      </div>

      {/* Remounted per mentor: their open tasks lead the list, and a task
          picked for one mentor must never be left selected under another's.
          The "" key is the unassigned pool's own open tasks. */}
      {!banked && (
        <TaskPicker
          key={`${programId}:${mentorId}`}
          optional
          openTasks={openTasks}
          bankOption={bankPrograms.includes(programId)}
          onPick={setAgenda}
        />
      )}

      {isBank ? (
        <BankChoice
          created={!bankedPrograms.includes(programId)}
          past={pastByProgram[programId]}
        />
      ) : (
        <Field label="Note">
          <GrowingField name="taskNote" maxLength={500} />
        </Field>
      )}

      {/* The figures that decide the grant on one row, with the submit at its
          end, where Log a session keeps its own. */}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Minutes" required className="w-full sm:w-28">
          <Input
            name="minutes"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            required
            measure="xs"
            // "e.g.", or a bare 180 reads as a value already filled in.
            placeholder="e.g. 180"
          />
        </Field>
        <Labelled label="Use by" required className="w-full sm:w-48">
          <DateField name="deadline" label="Use by" required />
        </Labelled>
        {showAmountPaid && (
          <Field label="Paid ($)" required className="w-full sm:w-28">
            <Input
              name="amountPaid"
              type="number"
              min="0"
              step="0.01"
              required
              measure="xs"
              placeholder="e.g. 1200"
            />
          </Field>
        )}
        <SubmitButton pendingText="Loading…">Allocate time</SubmitButton>
      </div>
      <SaveState state={save} />
    </form>
  );
}

/**
 * What the hour bank asks that a mentor's grant does not: do we include the
 * hours already spent in this program? Asked once, when the bank is created,
 * and only when there ARE past hours; after that it is only topped up.
 */
function BankChoice({
  created,
  past,
}: {
  created: boolean;
  past?: { allocated: number; logged: number };
}) {
  if (!created || !past || (past.allocated === 0 && past.logged === 0)) {
    // Why there is no mentor to name: every meeting draws the bank.
    return <p className="text-sm text-muted-fg">Added to their hour bank.</p>;
  }
  return (
    <fieldset className="min-w-0 space-y-1.5">
      <legend className="text-sm font-medium text-ink">
        Include past hours?
        <RequiredMark />
      </legend>
      <p className="text-xs tabular-nums text-muted-fg">
        {formatDuration(past.allocated)} allocated · {formatDuration(past.logged)} logged
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <BankRadio value="yes" title="Yes, include them" />
        <BankRadio value="no" title="No, keep them separate" />
      </div>
    </fieldset>
  );
}
function BankRadio({ value, title }: { value: "yes" | "no"; title: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
      <input
        type="radio"
        name="includePrevious"
        value={value}
        required
        className="accent-brand"
      />
      {title}
    </label>
  );
}
