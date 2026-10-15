"use client";

import { useState } from "react";

import { Select, type SelectOption } from "@/components/select";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { DateField } from "@/components/ui/date-field";
import { Field, Input } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { cancelClass, markClassHeld, scheduleClass } from "@/lib/actions/classes";

/**
 * Put a class in the diary.
 *
 * One picker names the student AND the program, because a balance belongs to
 * the pair: the same student held in two programs is two options, each
 * carrying what is still unreserved in that one. The server re-checks all of
 * it — the picker only offers what it will accept.
 */
export function ScheduleClassForm({
  targets,
  today,
}: {
  /** value is `studentId|programId`; the hint says what is left to reserve. */
  targets: SelectOption[];
  /** The program's today, `YYYY-MM-DD`: the earliest day a class can start. */
  today: string;
}) {
  const [, action, save] = useSaveState(scheduleClass);
  const [target, setTarget] = useState("");
  const [studentId, programId] = target.split("|");

  return (
    <form action={action} className="space-y-4 px-4 py-3 sm:px-5">
      <input type="hidden" name="studentId" value={studentId ?? ""} />
      <input type="hidden" name="programId" value={programId ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Student" required className="sm:col-span-2">
          <Select
            name="target"
            ariaLabel="Student"
            options={targets}
            placeholder="Choose a student"
            onChange={(value) => setTarget(value)}
          />
        </Field>
        <Field label="Day" required>
          <DateField name="date" min={today} defaultValue={today} required label="Class day" />
        </Field>
        <Field label="Starts at" required hint="Tashkent time">
          <Input name="time" type="time" required defaultValue="15:00" />
        </Field>
        <Field label="Length (minutes)" required>
          <Input name="minutes" type="number" inputMode="numeric" min={5} max={480} step={5} defaultValue={60} required />
        </Field>
        <Field label="Topic" hint="Optional">
          <Input name="topic" type="text" maxLength={120} placeholder="Algebra, reading drills…" />
        </Field>
      </div>
      <div>
        <SubmitButton pendingText="Booking…">Schedule class</SubmitButton>
        <SaveState state={save} />
      </div>
    </form>
  );
}

/** Take a class out of the diary — the hours it reserved go back. */
export function CancelClassButton({ classId }: { classId: string }) {
  const [, action, save] = useSaveState(cancelClass);
  return (
    <>
      <ConfirmInline
        variant="quiet"
        label="Cancel"
        question="Cancel this class? Its hours are unreserved again."
        confirmLabel="Yes, cancel it"
        cancelLabel="Keep it"
        pendingLabel="Cancelling…"
        action={action}
        values={{ classId }}
      />
      <SaveState state={save} />
    </>
  );
}

/** Tie a class to the session already logged for its day. */
export function MarkHeldButton({ classId }: { classId: string }) {
  const [, action, save] = useSaveState(markClassHeld);
  return (
    <form action={action}>
      <input type="hidden" name="classId" value={classId} />
      <SubmitButton variant="secondary" size="sm" pendingText="Linking…">
        Mark held
      </SubmitButton>
      <SaveState state={save} />
    </form>
  );
}
