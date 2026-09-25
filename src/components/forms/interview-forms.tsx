"use client";

import { useState } from "react";

import { DictateButton } from "@/components/forms/dictate-button";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { DateField } from "@/components/ui/date-field";
import { GrowingField, Input } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SegmentedRadio } from "@/components/ui/segmented";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  addInterviewSlot,
  bookInterview,
  cancelInterview,
  markInterviewDone,
  removeInterviewSlot,
  saveInterviewNotes,
} from "@/lib/actions/interviews";
import { cn } from "@/lib/cn";
import type { InterviewTemplate } from "@/lib/interview-templates";
import { NOTES_MAX, SLOT_LENGTHS } from "@/lib/peer-interviews";

/**
 * Offer a time for a classmate to book. Date, start, length — and the day
 * picker is bounded to the window the action accepts, so the calendar cannot
 * offer a day the server will refuse.
 */
export function OfferSlotForm({
  today,
  tomorrow,
  lastDay,
}: {
  today: string;
  /** The default day: today's afternoon has usually gone by the time anyone looks. */
  tomorrow: string;
  lastDay: string;
}) {
  const [, action, save] = useSaveState(addInterviewSlot);

  return (
    <form action={action} className="space-y-3 px-4 py-2 sm:px-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="text-sm">
          <span className="text-muted-fg">Day</span>
          <div className="mt-0.5">
            <DateField name="date" defaultValue={tomorrow} min={today} max={lastDay} required />
          </div>
        </div>
        <label className="block text-sm">
          <span className="text-muted-fg">Starts at (Tashkent)</span>
          <Input name="time" type="time" required defaultValue="15:00" className="mt-0.5" />
        </label>
        <SegmentedRadio
          name="minutes"
          legend="Length"
          options={SLOT_LENGTHS.map((m) => ({ value: String(m), label: `${m} min` }))}
          defaultValue="45"
          required
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Adding…">Add this time</SubmitButton>
        <SaveState state={save} />
      </div>
    </form>
  );
}

/** Withdraw an open time. Booked ones are cancelled from the interview. */
export function RemoveSlotButton({ slotId }: { slotId: string }) {
  const [, action, save] = useSaveState(removeInterviewSlot);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="slotId" value={slotId} />
      <SaveState state={save} />
      <SubmitButton variant="ghost" size="sm" pendingText="Removing…">
        Remove
      </SubmitButton>
    </form>
  );
}

export type OpenSlot = {
  id: string;
  /** "Tue, Sep 30" — the group heading. */
  day: string;
  /** "15:00–15:45". */
  span: string;
};

/**
 * Pick one of a classmate's times, pick what to practise, confirm.
 *
 * Both choices are radios rather than selects: there are a handful of each,
 * and seeing every option at once is the point — a student is choosing
 * between them, not looking one up.
 */
export function BookInterviewForm({
  slots,
  templates,
  classmate,
}: {
  slots: OpenSlot[];
  templates: readonly InterviewTemplate[];
  classmate: string;
}) {
  const [, action, save] = useSaveState(bookInterview);
  const [slotId, setSlotId] = useState("");
  const [templateId, setTemplateId] = useState("");

  const days = [...new Set(slots.map((s) => s.day))];

  return (
    <form action={action} className="space-y-4 px-4 py-2 sm:px-5">
      <fieldset>
        <legend className="text-sm text-muted-fg">1. Pick a time</legend>
        <div className="mt-2 space-y-3">
          {days.map((day) => (
            <div key={day}>
              <p className="text-xs font-semibold text-ink">{day}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {slots
                  .filter((s) => s.day === day)
                  .map((s) => (
                    <label key={s.id} className="inline-flex">
                      <input
                        type="radio"
                        name="slotId"
                        value={s.id}
                        required
                        checked={slotId === s.id}
                        onChange={() => setSlotId(s.id)}
                        className="peer sr-only"
                      />
                      <span className="inline-flex h-11 cursor-pointer items-center rounded-xl border border-line bg-surface px-3.5 text-sm font-medium tabular-nums text-ink transition hover:border-brand/40 peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:text-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">
                        {s.span}
                      </span>
                    </label>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm text-muted-fg">2. Pick what to practise</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {templates.map((t) => (
            <label key={t.id} className="flex">
              <input
                type="radio"
                name="template"
                value={t.id}
                required
                checked={templateId === t.id}
                onChange={() => setTemplateId(t.id)}
                className="peer sr-only"
              />
              <span className="flex w-full cursor-pointer flex-col rounded-xl border border-line bg-surface px-3.5 py-2.5 transition hover:border-brand/40 peer-checked:border-brand peer-checked:bg-brand-soft peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">
                <span className="text-sm font-semibold text-ink">{t.name}</span>
                <span className="mt-0.5 text-xs text-muted-fg">{t.summary}</span>
                <span className="mt-1 text-xs text-muted-fg">
                  {t.questions.length} questions
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Booking…">Book with {classmate}</SubmitButton>
        <SaveState state={save} />
      </div>
    </form>
  );
}

/** Call it off before it is marked done. The time opens up again. */
export function CancelInterviewButton({ interviewId }: { interviewId: string }) {
  const [, action, save] = useSaveState(cancelInterview);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ConfirmInline
        label="Cancel interview"
        question="Your classmate is told, and the time opens for others to book."
        confirmLabel="Yes, cancel it"
        cancelLabel="Keep it"
        pendingLabel="Cancelling…"
        pending={save.kind === "saving"}
        action={action}
        values={{ interviewId }}
      />
      <SaveState state={save} />
    </div>
  );
}

/** The spec's "Mark as Done": the interview happened. */
export function MarkDoneButton({ interviewId }: { interviewId: string }) {
  const [, action, save] = useSaveState(markInterviewDone);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="interviewId" value={interviewId} />
      <SubmitButton pendingText="Saving…">Mark as done</SubmitButton>
      <SaveState state={save} />
    </form>
  );
}

/**
 * This student's own notes on the interview: typed, dictated, or both, and
 * edited before saving. Dictation appends — a second take adds to the first
 * and anything already typed survives, as on the session log.
 */
export function InterviewNotesForm({
  interviewId,
  saved,
  canDictate,
}: {
  interviewId: string;
  saved: string;
  canDictate: boolean;
}) {
  const [notes, setNotes] = useState(saved);
  const [, action, save] = useSaveState(saveInterviewNotes, notes.trim() !== saved.trim());

  return (
    <form action={action} className="space-y-3 px-4 py-2 sm:px-5">
      <input type="hidden" name="interviewId" value={interviewId} />
      {/* A div, not a label: a button inside a label steals the click. */}
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-fg">Your notes</span>
        {canDictate && (
          <DictateButton
            interviewId={interviewId}
            onText={(text) => setNotes((was) => (was.trim() ? `${was.trim()} ${text}` : text))}
          />
        )}
      </div>
      <GrowingField
        name="notes"
        aria-label="Your notes"
        placeholder="How it went: answers that landed, what to work on next time"
        value={notes}
        maxLength={NOTES_MAX}
        onChange={(event) => setNotes(event.target.value)}
        className={cn("min-h-32 px-2.5 py-2")}
      />
      <p className="text-xs text-muted-fg">Only you can read these.</p>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Saving…">Save notes</SubmitButton>
        <SaveState state={save} />
      </div>
    </form>
  );
}
