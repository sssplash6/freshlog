"use client";

import { useState } from "react";

import { DictateButton } from "@/components/forms/dictate-button";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { DateField } from "@/components/ui/date-field";
import { Field, GrowingField, Input } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SegmentedRadio } from "@/components/ui/segmented";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  addInterviewSlot,
  bookInterview,
  cancelInterview,
  editInterviewFeedback,
  markInterviewDone,
  markPartnerAbsent,
  removeInterviewSlot,
  saveInterviewNotes,
} from "@/lib/actions/interviews";
import type { InterviewTemplate } from "@/lib/interview-templates";
import { MEETING_URL_MAX, NOTES_MAX, SLOT_LENGTHS } from "@/lib/peer-interviews";

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
    <form action={action} className="space-y-4 px-4 py-3 sm:px-5">
      {/* Top-aligned: the segmented track is a few pixels taller than an
          input, and bottom-aligned it lifted its legend off the line Day and
          Starts at sat on. */}
      <div className="flex flex-wrap items-start gap-3">
        <Field label="Day" className="w-full sm:w-48">
          <DateField name="date" defaultValue={tomorrow} min={today} max={lastDay} required />
        </Field>
        <Field label="Starts (Tashkent)" className="w-full sm:w-36">
          <Input name="time" type="time" required defaultValue="15:00" measure="xs" />
        </Field>
        <SegmentedRadio
          name="minutes"
          legend="Length"
          options={SLOT_LENGTHS.map((m) => ({ value: String(m), label: `${m} min` }))}
          defaultValue="45"
          // Not `required`: it always holds a value, and the asterisk it
          // drew was the only one on a form whose other fields are required
          // too and wear none.
        />
      </div>
      <Field label="Meeting link">
        <Input
          name="meetingUrl"
          type="url"
          inputMode="url"
          placeholder="https://meet.google.com/…"
          maxLength={MEETING_URL_MAX}
          measure="lg"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Adding…">Add time</SubmitButton>
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
 * Pick one of a classmate's times, pick a topic, confirm.
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
  // The first topic is chosen already: one fewer tap on every booking.
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");

  const days = [...new Set(slots.map((s) => s.day))];

  return (
    <form action={action} className="space-y-4 px-4 py-3 sm:px-5">
      <fieldset>
        <legend className="text-sm text-muted-fg">Time</legend>
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
                      <span className="inline-flex h-11 cursor-pointer items-center rounded-full bg-fill px-4 text-body font-medium tabular-nums text-ink transition-colors hover:bg-fill-strong peer-checked:bg-brand peer-checked:text-on-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">
                        {/* The day and its zone are the heading above, which a
                            screen reader does not attach to the radio — so the
                            radio's own name carries them. */}
                        <span className="sr-only">{day}, </span>
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
        <legend className="text-sm text-muted-fg">Topic</legend>
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
              <span className="flex min-h-11 w-full cursor-pointer items-center rounded-lg bg-fill px-3.5 py-2 text-body font-semibold text-ink transition-colors hover:bg-fill-strong peer-checked:bg-brand-soft peer-checked:ring-2 peer-checked:ring-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">
                {t.name}
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
        question="Cancel? Answers and feedback are deleted."
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
    <div className="flex flex-wrap items-center gap-3">
      {/* One tap ends the interview for both students, so it is a two-step
          claim rather than a bare submit — but not a destructive one, which
          is what the primary tone says. */}
      <ConfirmInline
        tone="primary"
        label="Mark as done"
        question="Mark it done?"
        confirmLabel="Yes, it happened"
        action={action}
        values={{ interviewId }}
        pending={save.kind === "saving"}
        pendingLabel="Saving…"
      />
      <SaveState state={save} />
    </div>
  );
}

/** The partner never joined. Closes the interview for both without completing it. */
export function MarkAbsentButton({
  interviewId,
  partner,
}: {
  interviewId: string;
  partner: string;
}) {
  const [, action, save] = useSaveState(markPartnerAbsent);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ConfirmInline
        label="Mark absent"
        question={`Mark ${partner} absent?`}
        confirmLabel="Yes, absent"
        cancelLabel="Keep it open"
        pendingLabel="Saving…"
        pending={save.kind === "saving"}
        action={action}
        values={{ interviewId }}
      />
      <SaveState state={save} />
    </div>
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
    <form action={action} className="space-y-3 px-4 py-3 sm:px-5">
      <input type="hidden" name="interviewId" value={interviewId} />
      {/* No label of its own: the section around it is titled "Notes". */}
      <GrowingField
        name="notes"
        aria-label="Notes"
        value={notes}
        maxLength={NOTES_MAX}
        onChange={(event) => setNotes(event.target.value)}
        className="min-h-32 px-2.5 py-2"
      />
      {/* design-allow: privacy promise */}
      <p className="text-xs text-muted-fg">Only you and your mentors see these.</p>
      <div className="flex flex-wrap items-center gap-3">
        {canDictate && (
          <DictateButton
            interviewId={interviewId}
            onText={(text) => setNotes((was) => (was.trim() ? `${was.trim()} ${text}` : text))}
          />
        )}
        <SubmitButton pendingText="Saving…">Save notes</SubmitButton>
        <SaveState state={save} />
      </div>
    </form>
  );
}

type SentFeedback = { summary: string; wentWell: string; toImprove: string };

/**
 * Correct feedback already sent, while its edit window is open. The page stops
 * rendering this once the window closes, and the action refuses after it too;
 * the section's caption says when.
 */
export function EditFeedbackForm({
  interviewId,
  saved,
}: {
  interviewId: string;
  saved: SentFeedback;
}) {
  const [feedback, setFeedback] = useState(saved);
  const unsaved = (Object.keys(saved) as (keyof SentFeedback)[]).some(
    (key) => feedback[key].trim() !== saved[key].trim()
  );
  const [, action, save] = useSaveState(editInterviewFeedback, unsaved);
  const boxes: { key: keyof SentFeedback; label: string }[] = [
    { key: "summary", label: "Summary" },
    { key: "wentWell", label: "What went well" },
    { key: "toImprove", label: "What to improve" },
  ];

  return (
    <form action={action} className="space-y-3 px-4 py-3 sm:px-5">
      <input type="hidden" name="interviewId" value={interviewId} />
      {boxes.map(({ key, label }) => (
        <Field key={key} label={label}>
          <GrowingField
            name={key}
            value={feedback[key]}
            maxLength={NOTES_MAX}
            onChange={(event) => setFeedback((was) => ({ ...was, [key]: event.target.value }))}
          />
        </Field>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
        <SaveState state={save} />
      </div>
    </form>
  );
}
