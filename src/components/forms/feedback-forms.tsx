"use client";

import { useState } from "react";

import { submitMentorFeedback } from "@/lib/actions/feedback";
import { StarIcon } from "@/components/icons";
import { Select } from "@/components/select";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";

const inputClass =
  "w-full rounded-lg border border-line px-3.5 py-2.5 text-[0.9375rem] focus:border-brand focus:outline-none";

/** Native radio inputs retain expected keyboard behavior while labels render
 * as a large, tap-friendly star picker. */
export function StarRating({
  name,
  idPrefix,
  legend = "Rating *",
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
    <fieldset className="block text-sm">
      <legend className="text-muted-fg">{legend}</legend>
      <div
        className="mt-1 flex items-center gap-0.5"
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
              className={`inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand ${
                n <= shown ? "text-accent" : "text-line"
              }`}
            >
            <StarIcon
              className="h-7 w-7"
              aria-hidden="true"
            />
            <span className="sr-only">{n} star{n === 1 ? "" : "s"}</span>
            </label>
          </span>
        ))}
        {shown > 0 && (
          <span className="ml-2 text-sm font-medium tabular-nums text-muted-fg">
            {shown}/5
          </span>
        )}
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
    // No heading of its own: the page's title says "Rate a mentor" directly
    // above this, and the form was repeating it word for word.
    <form action={action} className="rounded-xl border border-line bg-surface shadow-sm p-4">
      <p className="text-xs text-muted-fg">
        Your name isn&apos;t shown to the mentor.
      </p>
      <div className="mt-3 space-y-3">
        <div className="block text-sm">
          <span className="text-muted-fg">Mentor *</span>
          <div className="mt-0.5">
            <Select
              name="mentorId"
              ariaLabel="Mentor"
              defaultValue={defaultMentorId ?? ""}
              options={mentors.map((m) => ({ value: m.id, label: m.label }))}
            />
          </div>
        </div>
        <StarRating name="rating" idPrefix="mentor-rating" />
        <label className="block text-sm">
          <span className="text-muted-fg">Comment</span>
          <textarea
            name="comment"
            rows={3}
            placeholder="Optional: what went well, what could be better?"
            className={inputClass}
          />
        </label>
      </div>
      <SubmitButton pendingText="Sending…" className="mt-3">
        Submit mentor feedback
      </SubmitButton>
      <SaveState state={save} />
    </form>
  );
}
