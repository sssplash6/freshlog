"use client";

import { useState } from "react";

import { submitMentorFeedback } from "@/lib/actions/feedback";
import { StarIcon } from "@/components/icons";
import { Select } from "@/components/select";
import { inputClasses } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/cn";
import { RequiredMark } from "@/components/ui/required-mark";

// The shared field chrome — `text-base` under `sm`, so iOS does not zoom the
// page when the comment box takes focus (it did, at the old 15px).
const inputClass = cn(inputClasses, "resize-y leading-relaxed");

/** What each number of stars means, in the student's words. */
const STAR_WORDS = ["Not helpful", "Could be better", "Okay", "Good", "Great"];

/** Native radio inputs retain expected keyboard behavior while labels render
 * as a large, tap-friendly star picker. */
export function StarRating({
  name,
  idPrefix,
  legend = "Rating",
  required = true,
}: {
  name: string;
  idPrefix: string;
  legend?: string;
  /** False where a rating is a courtesy rather than the point of the form. */
  required?: boolean;
}) {
  const [value, setValue] = useState(0);
  const [hovered, setHovered] = useState(0);
  const shown = hovered || value;

  return (
    <fieldset className="block">
      {/* The same label every `Field` wears, so the stars read as one field
          among the form's others rather than a caption above a picture. */}
      <legend className="text-sm font-medium text-ink">
        {legend}
        {required && <RequiredMark />}
      </legend>
      <div
        // -ml-2 puts the first star's glyph, not its 44px target, on the
        // form's left edge, under the label it belongs to.
        className="-ml-2 mt-0.5 flex items-center"
        onMouseLeave={() => setHovered(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className="inline-flex"
            onMouseEnter={() => setHovered(n)}
          >
            <input
              id={`${idPrefix}-${n}`}
              type="radio"
              name={name}
              value={n}
              required={required && n === 1}
              checked={value === n}
              onChange={() => setValue(n)}
              className="peer sr-only"
            />
            <label
              htmlFor={`${idPrefix}-${n}`}
              className={cn(
                "inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg transition-colors active:scale-90 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[-2px] peer-focus-visible:outline-brand",
                // Muted rather than the control fill: `fill-strong` is a 20%
                // grey that all but vanished on a white card, so an empty
                // picker read as no picker at all.
                n <= shown ? "text-ink" : "text-muted-fg/70"
              )}
            >
              <StarIcon className="h-7 w-7 transition-transform" aria-hidden="true" />
              <span className="sr-only">{n} star{n === 1 ? "" : "s"}</span>
            </label>
          </span>
        ))}
        {/* A word, not "4/5": a fraction is a score, and the student is
            saying how it went. Announced as it changes, so a screen-reader
            user hears their choice land. */}
        <span
          aria-live="polite"
          className="ml-1 text-xs font-medium text-muted-fg"
        >
          {shown > 0 ? STAR_WORDS[shown - 1] : ""}
        </span>
      </div>
    </fieldset>
  );
}

export function MentorFeedbackForm({
  mentors,
  /** From `/student/feedback?mentor=` — the person a "Rate" link came from. */
  defaultMentorId,
}: {
  mentors: { id: string; label: string }[];
  defaultMentorId?: string;
}) {
  const [, action, save] = useSaveState(submitMentorFeedback);

  return (
    // No heading of its own: the page's title says "Report a mentor" directly
    // above this, and the form was repeating it word for word.
    <form action={action} className="rounded-xl bg-surface px-4 py-3 shadow-sm sm:px-5">
      <div className="space-y-4">
        <div className="block">
          <span className="block text-sm font-medium text-ink">
            Mentor<RequiredMark />
          </span>
          <div className="mt-1.5">
            <Select
              name="mentorId"
              ariaLabel="Mentor"
              placeholder="Choose a mentor"
              requiredMessage="Pick who you're rating."
              title="Mentor"
              defaultValue={defaultMentorId ?? ""}
              options={mentors.map((m) => ({ value: m.id, label: m.label }))}
            />
          </div>
        </div>
        <StarRating name="rating" idPrefix="mentor-rating" />
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-ink">Comment</span>
          {/* Under the label, where the worry starts. */}
          <span className="block text-xs text-muted-fg">
            Your mentor can&apos;t see who wrote this.
          </span>
          <textarea
            name="comment"
            rows={3}
            placeholder="Optional"
            className={inputClass}
          />
        </label>
      </div>
      <div className="mt-4">
        <SubmitButton pendingText="Sending…">Send</SubmitButton>
      </div>
      <SaveState state={save} />
    </form>
  );
}
