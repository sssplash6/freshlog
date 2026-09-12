"use client";

import { useState } from "react";
import { GrowingField } from "@/components/ui/field";

import { scheduleInterview } from "@/lib/actions/interviews";
import { Button } from "@/components/ui/button";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { toDateInputValue } from "@/lib/format";

const inputClass =
  "mt-0.5 w-full rounded-lg border border-line px-3.5 py-2.5 text-[0.9375rem] focus:border-brand focus:outline-none";

/**
 * Put an interview in a student's diary. Only the date is required — a mentor
 * often knows the day before the hour, and the link before the agenda — so the
 * time, the link and the note are all optional and say so.
 *
 * Expands in place rather than opening a dialog: it lives directly above the
 * list it adds to, so what it does is visible without having to be explained,
 * and the list is still readable while filling it in.
 */
export function ScheduleInterviewForm({
  studentProfileId,
  studentName,
}: {
  studentProfileId: string;
  studentName: string;
}) {
  const [state, action, save] = useSaveState(scheduleInterview);
  const [open, setOpen] = useState(false);
  const today = toDateInputValue(new Date());

  // Collapse once a meeting is actually booked, so the filled-in fields can't
  // be submitted a second time by a mentor who thinks the first didn't take.
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
          Schedule an interview
        </Button>
        {/* The last result survives the form closing, so a mentor who submits
            and collapses it still sees that it worked. */}
        <SaveState state={save} />
      </div>
    );
  }

  return (
    <form action={action} className="rise-in">
      <input type="hidden" name="studentProfileId" value={studentProfileId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block min-w-0 text-sm">
          <span className="text-muted-fg">Date *</span>
          <input
            name="date"
            type="date"
            required
            min={today}
            defaultValue={today}
            className={inputClass}
          />
        </label>
        <label className="block min-w-0 text-sm">
          <span className="text-muted-fg">Time</span>
          <input name="time" type="time" className={inputClass} />
        </label>
        <label className="block min-w-0 text-sm sm:col-span-2">
          <span className="text-muted-fg">Link</span>
          <input
            name="link"
            type="text"
            inputMode="url"
            placeholder="Optional — Meet, Zoom, or where to turn up"
            className={inputClass}
          />
        </label>
        <label className="block min-w-0 text-sm sm:col-span-2">
          <span className="text-muted-fg">Note</span>
          <GrowingField
            name="note"
            placeholder="Optional — what the interview covers, and how to prepare"
                    />
        </label>
      </div>

      <p className="mt-2.5 text-xs text-muted-fg">
        {studentName}{" "}
        is notified and asked to confirm they&apos;ll be there. Nothing is
        charged until you log the hours afterwards.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SubmitButton pendingText="Scheduling…">Schedule it</SubmitButton>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <SaveState state={save} />
    </form>
  );
}
