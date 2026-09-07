"use client";

import { useState } from "react";

import { Input } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SettingsRow } from "@/components/ui/settings-row";
import { SubmitButton } from "@/components/ui/submit-button";
import { setBookingLink } from "@/lib/actions/mentors";

/** One row per assignment: the mentor sets the booking link students in
 * that program (or cohort) use to book them. */
function BookingLinkRow({
  assignment,
}: {
  assignment: { id: string; label: string; calendlyUrl: string | null };
}) {
  const saved = assignment.calendlyUrl ?? "";
  const id = `booking-link-${assignment.id}`;
  const [url, setUrl] = useState(saved);
  const [, action, save] = useSaveState(setBookingLink, url !== saved);

  return (
    <SettingsRow
      label={assignment.label}
      htmlFor={id}
      description={
        assignment.calendlyUrl
          ? undefined
          : "Students in this program can't book you until this is set."
      }
      control={
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="assignmentId" value={assignment.id} />
          <Input
            id={id}
            name="calendlyUrl"
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://calendly.com/…"
            className="min-w-56 flex-1"
          />
          <SubmitButton pendingText="Saving…">Save</SubmitButton>
        </form>
      }
      state={<SaveState state={save} />}
    />
  );
}

/**
 * The mentor's booking links, one per program/cohort assignment. Students
 * only see a "Book" button once the link for their program is set. Collapsed
 * behind one button; the missing-link count stays visible on it.
 */
export function BookingLinksForm({
  assignments,
}: {
  assignments: { id: string; label: string; calendlyUrl: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const missing = assignments.filter((a) => !a.calendlyUrl).length;

  return (
    <section className="rounded-xl border border-line bg-surface shadow-sm p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-base font-semibold text-ink">
          Your booking links
          {missing > 0 && (
            <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn-ink">
              {missing} missing
            </span>
          )}
        </span>
        <span className="text-sm text-muted-fg">
          {open ? "Hide ▴" : "Show ▾"}
        </span>
      </button>
      {open && (
        <div className="rise-in">
          <p className="mt-1 text-xs text-muted-fg">
            Students book sessions through these links (e.g. your Calendly),
            one per program you&apos;re assigned to.
          </p>
          <div className="mt-1">
            {assignments.map((a) => (
              <BookingLinkRow key={a.id} assignment={a} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
