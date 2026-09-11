"use client";

import { useState } from "react";

import { Select, type SelectOption } from "@/components/select";
import { Button } from "@/components/ui/button";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { Field, Input } from "@/components/ui/field";
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
  studentName,
  /** The student's OWN programs, one of which does the lending. */
  fromPrograms,
  /** Everywhere they could go: active programs they are not already in. */
  toPrograms,
}: {
  studentProfileId: string;
  studentName: string;
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

  if (toPrograms.length === 0) {
    return (
      <p className="text-sm text-muted-fg">
        {studentName} is already in every program you can send them to.
      </p>
    );
  }

  if (!open) {
    return (
      <div>
        <Button size="sm" onClick={() => setOpen(true)}>
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
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Asked only when there is a question. A student who studies in one
            program is not asked which of their one programs is lending them. */}
        {fromPrograms.length > 1 && (
          <Field label="From">
            <Select
              name="fromProgramId"
              options={fromPrograms}
              ariaLabel="Program sending them"
              placeholder="Which of their programs"
            />
          </Field>
        )}
        <Field label="To">
          <Select
            name="toProgramId"
            options={toPrograms}
            ariaLabel="Program to send them to"
            placeholder="Which program"
          />
        </Field>
        <Field label="Minutes">
          <Input name="minutes" type="number" min="1" step="1" required placeholder="420" />
        </Field>
        <Field label="Use by">
          <Input name="deadline" type="date" required />
        </Field>
        <div className="sm:col-span-2">
          <Field label="What they need">
            <Input
              name="note"
              type="text"
              maxLength={500}
              placeholder="Optional — what you are sending them for"
            />
          </Field>
        </div>
      </div>

      <p className="mt-2.5 text-xs text-muted-fg">
        That program&apos;s admins are asked to put the time on one of their
        mentors, and may allocate no more than this. Every session they log
        shows here too.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SubmitButton pendingText="Sending…">Send them</SubmitButton>
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
 * consequence is in a different program from the person reading: the hours the
 * host had already put on its mentors go with it. A placement anything has been
 * logged against is refused by the action, which is the one case this cannot
 * know from here.
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
        size="sm"
        action={action}
        values={{ exchangeId }}
        pending={save.kind === "saving"}
        label="Call it off"
        disabledReason={
          canReturn
            ? undefined
            : `Time has been logged in ${hostProgram}, so this is history now.`
        }
        question={`The hours ${hostProgram} put on its mentors go with it. Both programs are told.`}
        confirmLabel="Yes, call it off"
        pendingLabel="Calling off…"
      />
      <SaveState state={save} />
    </div>
  );
}
