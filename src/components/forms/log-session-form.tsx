"use client";

import { useActionState, useRef, useState } from "react";

import { logSession } from "@/lib/actions/sessions";
import type { ActionState } from "@/lib/actions/shared";
import { AttendancePicker } from "@/components/forms/attendance-picker";
import { TimeKindPicker } from "@/components/forms/time-kind-picker";
import { Select } from "@/components/select";
import { GrowingField } from "@/components/ui/field";
import { Receipt } from "@/components/ui/receipt";
import { SaveState, saveStateFrom } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/cn";
import { toDateInputValue } from "@/lib/format";

const inputClass =
  "w-full rounded-lg border border-line px-3.5 py-2.5 text-[0.9375rem] focus:border-brand focus:outline-none";
const badInputClass = "border-danger-line bg-danger-soft/40";

export type LogSessionStudent = {
  profileId: string;
  /** The student's name — the only thing the picker is scanned by. */
  label: string;
  /** Balance, program, email: searchable metadata, shown under the name. */
  hint: string;
  /** The one line worth repeating under the closed select. */
  balance?: string;
  /** The mentor's own open tasks for this student, in the admin's order. */
  goals: { value: string; label: string }[];
  /**
   * The programs of theirs this mentor could be logging into, best first.
   *
   * Almost always one, and then the form never mentions it — it posts the id
   * and asks nothing. A student in two of the mentor's programs gets a select,
   * because the hours, the deadline and the task list are all different on the
   * other side of that choice.
   */
  programs: {
    value: string;
    label: string;
    balance: string;
    goals: { value: string; label: string }[];
  }[];
};

/** What the form should open with — a URL draft, or the last failed attempt. */
export type LogSessionDraft = {
  studentProfileId?: string;
  programId?: string;
  assignmentId?: string;
  minutes?: string;
  date?: string;
  note?: string;
  attendance?: string;
  timeKind?: string;
};

/**
 * Log a completed session. Naming the task it went toward is what lets planned
 * hours be read against delivered ones, but it is optional: a meeting that fits
 * none of the tasks still happened, and waiting on an admin to invent one would
 * mean the hours go unlogged. Tasks belong to a student, so the list is
 * re-scoped whenever the student changes, and both selects are keyed to that
 * student so a stale task can't be left selected underneath a new one.
 *
 * Two shapes. `inline` is the card this has always been. `page` is
 * `/sessions/new`: one column, a full-width submit, and a receipt in place of
 * the form on success — on a phone that is the difference between a form you
 * can fill with one thumb and one you cannot.
 */
export function LogSessionForm({
  students,
  mode = "inline",
  draft,
    /**
   * Where "Correct it" goes, minus the session id — this is a base rather than
   * a `(id) => href` function because a function cannot cross the server-to-
   * client boundary. Passing one type-checks, builds, and throws at render
   * with "Functions cannot be passed directly to Client Components".
   */
  correctBase,
  /** The same form, empty — a link, so the back button still works. */
  againHref,
}: {
  students: LogSessionStudent[];
  mode?: "inline" | "page";
  draft?: LogSessionDraft;
    correctBase?: string;
  againHref?: string;
}) {
    // The attempt counter is what lets the two SegmentedRadio pickers survive a
  // failed submit. They hold their choice in `useState`, and React 19 resets
  // the form's DOM once the action settles — so the radio goes back to
  // unchecked while the component still believes it is on "Late", and the
  // mentor's answer is silently lost. Remounting them per attempt makes the
  // echoed value the one that wins.
  const [{ state, attempt }, action, pending] = useActionState(
    async (prev: { state: ActionState; attempt: number }, formData: FormData) => ({
      state: await logSession(prev.state, formData),
      attempt: prev.attempt + 1,
    }),
    { state: null as ActionState, attempt: 0 }
  );
  const page = mode === "page";

  // What the form opens with: the last failed attempt if there was one — React
  // 19 clears an uncontrolled form when its action settles, which loses the
  // note and the date along with the one wrong field — otherwise the URL draft.
  const echoed = state && !state.ok ? state.values : undefined;
  const opening: LogSessionDraft = { ...draft, ...echoed };
  const badField = state && !state.ok ? state.field : undefined;

  const [studentId, setStudentId] = useState(
    opening.studentProfileId ?? (students.length === 1 ? students[0].profileId : "")
  );
  const formRef = useRef<HTMLFormElement>(null);
  const today = toDateInputValue(new Date());

  const student = students.find((s) => s.profileId === studentId);
  const programs = student?.programs ?? [];
  // Reset with the student: last week's program is not an answer about this
  // one, and a stale id would be rejected by the action rather than silently
  // used — but a rejection the mentor cannot see the cause of is worse.
  const [programId, setProgramId] = useState(opening.programId ?? "");
  const chosen =
    programs.find((p) => p.value === programId) ??
    (programs.length === 1 ? programs[0] : undefined);
  const goals = chosen?.goals ?? student?.goals ?? [];
  const balance = chosen?.balance ?? student?.balance;
  const noGoals = Boolean(student) && Boolean(chosen) && goals.length === 0;

  /**
   * Keep the draft in the URL, so a phone interruption — a call, a lock
   * screen, a back tap — does not lose a half-written session.
   *
   * `history.replaceState` rather than a router push: this must not re-render
   * the page or add a history entry, and the values are only ever read back on
   * a fresh load.
   */
  function rememberDraft() {
    if (!page || typeof window === "undefined") return;
    const form = formRef.current;
    if (!form) return;
        const url = new URL(window.location.href);
    // Every field, so a reload restores the same form a failed submit does.
    // Attendance and kind are one tap each, but "cheap to redo" is not the
    // same as "restored", and two draft mechanisms that disagree is worse
    // than either.
    for (const name of [
      "studentProfileId",
      "programId",
      "assignmentId",
      "minutes",
      "date",
      "note",
      "attendance",
      "timeKind",
    ]) {
      const value = String(new FormData(form).get(name) ?? "");
      if (value) url.searchParams.set(name, value);
      else url.searchParams.delete(name);
    }
    window.history.replaceState(null, "", url);
  }

  if (page && state?.ok && state.receipt) {
    return (
      <Receipt
        receipt={state.receipt}
                correctHref={correctBase ? `${correctBase}${state.receipt.id}` : undefined}
        onAgainHref={againHref}
      />
    );
  }

  return (
    <form
      ref={formRef}
      action={action}
      onChange={rememberDraft}
      className={cn(!page && "rounded-xl border border-line bg-surface shadow-sm p-4")}
    >
      {!page && (
        <h2 className="text-base font-semibold text-ink">Log a completed session</h2>
      )}
      {/* min-w-0 on every cell: a grid item's automatic minimum size is its
          content, so the longest option label was widening the column past the
          screen on a phone — and the dropdown, anchored to it, went with it. */}
      <div
        className={cn(
          "grid gap-3",
          page ? "gap-4 sm:grid-cols-2" : "mt-3 sm:grid-cols-2 lg:grid-cols-3"
        )}
      >
        <div className={cn("block min-w-0 text-sm", page && "sm:col-span-2")}>
          <span className="text-muted-fg">Student *</span>
          <div className="mt-0.5">
            <Select
              name="studentProfileId"
              ariaLabel="Student"
              defaultValue={studentId}
              onChange={(value) => {
                setStudentId(value);
                setProgramId("");
                rememberDraft();
              }}
              // A mentor logs for the same few students week after week, and a
              // full caseload is far too long to scan: last picks lead, and the
              // rest is filtered by name, email, or program.
              recentKey="log-session-student"
              options={students.map((s) => ({
                value: s.profileId,
                label: s.label,
                hint: s.hint,
              }))}
            />
          </div>
          {balance && <p className="mt-1 text-xs text-muted-fg">{balance}</p>}
          <FieldError show={badField === "studentProfileId"} state={state} />
        </div>
        {/* Only when it is a real question. One program is posted, not asked:
            a select with a single option is a control that cannot be wrong and
            still costs a row of the screen to read. */}
        {programs.length === 1 && (
          <input type="hidden" name="programId" value={programs[0].value} />
        )}
        {programs.length > 1 && (
          <div className="block min-w-0 text-sm">
            <span className="text-muted-fg">Program *</span>
            <div className="mt-0.5">
              <Select
                key={studentId}
                name="programId"
                ariaLabel="Program"
                defaultValue={programId || programs[0].value}
                onChange={(value) => {
                  setProgramId(value);
                  rememberDraft();
                }}
                options={programs.map((p) => ({
                  value: p.value,
                  label: p.label,
                  hint: p.balance,
                }))}
              />
            </div>
            <FieldError show={badField === "programId"} state={state} />
          </div>
        )}
        <div className="block min-w-0 text-sm">
          <span className="text-muted-fg">Task worked on</span>
          <div className="mt-0.5">
            <Select
              // Remount per student so the previous student's goal is never
              // left selected behind the new student's list.
              key={`${studentId}:${chosen?.value ?? ""}`}
              name="assignmentId"
              ariaLabel="Task worked on"
              defaultValue={opening.assignmentId}
              options={goals}
              required={false}
              placeholder={
                !student
                  ? "Pick a student first…"
                  : noGoals
                    ? "No tasks assigned yet"
                    : "Optional — choose a task…"
              }
            />
          </div>
          <FieldError show={badField === "assignmentId"} state={state} />
        </div>
        <label className="block min-w-0 text-sm">
          <span className="text-muted-fg">Minutes *</span>
          <input
            name="minutes"
            type="number"
            min="1"
            step="1"
            required
            inputMode="numeric"
            placeholder="90"
            defaultValue={opening.minutes}
            aria-invalid={badField === "minutes" || undefined}
            className={cn(inputClass, badField === "minutes" && badInputClass)}
          />
          <FieldError show={badField === "minutes"} state={state} />
        </label>
        <label className="block min-w-0 text-sm">
          <span className="text-muted-fg">Date *</span>
          <input
            name="date"
            type="date"
            required
            defaultValue={opening.date ?? today}
            max={today}
            aria-invalid={badField === "date" || undefined}
            className={cn(inputClass, badField === "date" && badInputClass)}
          />
          <FieldError show={badField === "date"} state={state} />
        </label>
        <label
          className={cn(
            "block min-w-0 text-sm",
            page ? "sm:col-span-2" : "sm:col-span-2 lg:col-span-3"
          )}
        >
          <span className="text-muted-fg">Notes</span>
          <GrowingField
            name="note"
            placeholder="Optional — what you covered, and what's next"
            defaultValue={opening.note}
          />
        </label>
      </div>

      {noGoals && (
        <p className="mt-3 text-xs text-muted-fg">
          No tasks assigned to you for this student yet — log the session
          anyway, and it can be attached to a task later with “Edit”.
        </p>
      )}

      {/* Two questions about the same meeting, side by side: how it went, and
          whether it spends the student's time. */}
      <div
        className={cn(
          "flex flex-wrap items-end justify-between gap-x-6 gap-y-3",
          page ? "mt-5" : "mt-3"
        )}
      >
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                    <AttendancePicker key={`attendance-${attempt}`} defaultValue={opening.attendance} />
          <TimeKindPicker key={`kind-${attempt}`} defaultValue={opening.timeKind} />
        </div>
        {!page && (
          <SubmitButton pendingText="Logging…" className="min-w-40">
            Log session
          </SubmitButton>
        )}
      </div>

      {page && (
        <div className="mt-6">
          <SubmitButton pendingText="Logging…" className="w-full sm:w-auto sm:min-w-48">
            Log session
          </SubmitButton>
        </div>
      )}

            {/* The whole-form error, for the failures no single field owns: not
          assigned to the program, hours expired, already logged. Suppressed
          when a field owns it, or the same sentence appears twice. */}
      {!badField && <SaveState state={saveStateFrom(state, pending)} />}
    </form>
  );
}

/**
 * The error, under the field that caused it.
 *
 * A form with seven inputs and one message at the bottom makes the reader
 * re-read all seven to find out which one is wrong. The server names the field
 * (`ActionState.field`) precisely so this can sit next to it.
 */
function FieldError({ show, state }: { show: boolean; state: ActionState }) {
  if (!show || !state || state.ok) return null;
  return (
    <p role="alert" className="mt-1 text-xs font-medium text-danger-ink">
      {state.error}
    </p>
  );
}
