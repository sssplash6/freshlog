"use client";

import { useState } from "react";

import { ChevronDownIcon } from "@/components/icons";
import { Input } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SettingsRow } from "@/components/ui/settings-row";
import { SubmitButton } from "@/components/ui/submit-button";
import { setBookingLink } from "@/lib/actions/mentors";
import { cn } from "@/lib/cn";

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
      control={
        <form action={action} className="flex items-end gap-2">
          <input type="hidden" name="assignmentId" value={assignment.id} />
          <Input
            id={id}
            name="calendlyUrl"
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://calendly.com/…"
            measure="lg"
            className="min-w-0"
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
 * only see a "Book" button once the link for their program is set. One fold,
 * open on arrival while a link is missing: the missing-link warning sends the
 * mentor here, and a closed fold would be a second click. An empty field is
 * what says which one.
 */
export function BookingLinksForm({
  assignments,
  bare = false,
}: {
  assignments: { id: string; label: string; calendlyUrl: string | null }[];
  /**
   * Already inside a card (Settings' "Booking links" group): drop this
   * component's own surface, so the page does not show a card in a card.
   */
  bare?: boolean;
}) {
  const [open, setOpen] = useState(() => assignments.some((a) => !a.calendlyUrl));

  return (
    <section className={bare ? undefined : "rounded-xl bg-surface px-4 py-3 shadow-sm sm:px-5"}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-11 w-fit cursor-pointer items-center gap-2 text-left text-title font-semibold text-ink"
      >
        Your booking links
        {/* A chevron that turns, the same fold every Disclosure draws. */}
        <ChevronDownIcon
          aria-hidden="true"
          className={cn("h-4 w-4 text-brand transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="rise-in mt-1">
          {assignments.map((a) => (
            <BookingLinkRow key={a.id} assignment={a} />
          ))}
        </div>
      )}
    </section>
  );
}
