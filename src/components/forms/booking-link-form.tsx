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
  bare = false,
}: {
  assignments: { id: string; label: string; calendlyUrl: string | null }[];
  /**
   * Already inside a card (Settings' "Booking links" group): drop this
   * component's own surface, so the page does not show a card in a card.
   */
  bare?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const missing = assignments.filter((a) => !a.calendlyUrl).length;

  return (
    <section className={bare ? undefined : "rounded-xl bg-surface px-4 py-3 shadow-sm sm:px-5"}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-[1.0625rem] font-semibold text-ink">
          Your booking links
          {missing > 0 && (
            <span className="rounded-full bg-warn-soft px-2.5 py-[0.1875rem] text-xs font-medium text-warn-ink">
              {missing} missing
            </span>
          )}
        </span>
        {/* A chevron that turns, not "Show ▾" / "Hide ▴" typed as text —
            the same fold every Disclosure in the app draws. */}
        <span className="flex items-center gap-1 text-[0.9375rem] font-medium text-brand">
          {open ? "Hide" : "Show"}
          <ChevronDownIcon
            aria-hidden="true"
            className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
          />
        </span>
      </button>
      {open && (
        <div className="rise-in">
          <p className="mt-1 text-[0.8125rem] text-muted-fg">
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
