"use client";

import { useState } from "react";

import { Select, type SelectOption } from "@/components/select";
import { Button } from "@/components/ui/button";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { Field, Input } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { returnExchange, sendOnExchange } from "@/lib/actions/exchanges";

/**
 * Lending a student to another program, and calling it off.
 *
 * The form expands in place under the exchanges it adds to, the same shape
 * `ScheduleInterviewForm` uses and for the same reason: what it does is legible
 * from where it sits, and the list stays readable while it is being filled in.
 *
 * It asks four things and no more. Everything else about the arrangement —
 * which mentor there does the work, what the hours are spent on — belongs to
 * the program receiving them, and a sender guessing at it in advance is how a
 * placement arrives with instructions its host never agreed to.
 */
export function SendOnExchangeForm({
  studentProfileId,
  /** The student's OWN programs, one of which does the lending. */
  fromPrograms,
  /** Everywhere they could go: active programs they are not already in. */
  toPrograms,
}: {
  studentProfileId: string;
  /** Unused since the form says nothing when there is nowhere to send them. */
  studentName?: string;
  fromPrograms: SelectOption[];
  toPrograms: SelectOption[];
}) {
  const [state, action, save] = useSaveState(sendOnExchange);
  const [open, setOpen] = useState(false);

  // Collapse once it has actually gone, so the filled-in fields cannot be sent
  // a second time by somebody who thinks the first did not take. Adjusted
  // during render — state reacting to new state, which React settles in the
  // same pass rather than a second one.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }

  // Nowhere left to send them: no button, and no sentence in its place.
  if (toPrograms.length === 0) return null;

  if (!open) {
    return (
      <div>
        {/* The page's own button size: at `sm` it was a 32px button among
            44px ones, the only small action on a page of full-size ones. */}
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Send on exchange
        </Button>
        {/* The last result outlives the form closing, so somebody who submits
            and collapses it still sees that it worked. */}
        <SaveState state={save} />
      </div>
    );
  }

  return (
    <form action={action} className="rise-in">
      <input type="hidden" name="studentProfileId" value={studentProfileId} />
      <div className="space-y-3">
        {/* Where from and where to on one row, how much and by when on the
            next, each field as wide as what it holds. */}
        <div className="flex flex-wrap items-end gap-3">
          {/* Asked only when there is a question. A student who studies in one
              program is not asked which of their one programs is lending them. */}
          {fromPrograms.length > 1 && (
            <Field label="From" className="w-full sm:w-80">
              <Select name="fromProgramId" options={fromPrograms} ariaLabel="Program sending them" />
            </Field>
          )}
          <Field label="To" className="w-full sm:w-80">
            <Select name="toProgramId" options={toPrograms} ariaLabel="Program to send them to" />
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Minutes">
            <Input
              name="minutes"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              required
              measure="xs"
              placeholder="e.g. 420"
            />
          </Field>
          <Field label="Use by">
            <DateField name="deadline" label="Use by" required />
          </Field>
        </div>
        <Field label="Note">
          <Input name="note" type="text" maxLength={500} measure="lg" />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SubmitButton pendingText="Sending…">Send</SubmitButton>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <SaveState state={save} />
    </form>
  );
}

/**
 * Call a placement off — the host declining it, or the sender withdrawing it.
 *
 * The question names the consequence rather than the row, because the
 * consequence is in a different program from the person reading. A placement
 * anything has been logged against is refused by the action, which is the one
 * case this cannot know from here.
 */
export function ReturnExchangeButton({
  exchangeId,
  hostProgram,
  canReturn,
}: {
  exchangeId: string;
  hostProgram: string;
  /** False once time has been logged: the action refuses, and so does this. */
  canReturn: boolean;
}) {
  const [, action, save] = useSaveState(returnExchange);

  return (
    <div>
      <ConfirmInline
        variant="quiet"
        action={action}
        values={{ exchangeId }}
        pending={save.kind === "saving"}
        label="Call it off"
        disabledReason={canReturn ? undefined : `Time logged in ${hostProgram}`}
        question={`Removes the time ${hostProgram} granted.`}
        confirmLabel="Yes, call it off"
        pendingLabel="Calling off…"
      />
      <SaveState state={save} />
    </div>
  );
}
