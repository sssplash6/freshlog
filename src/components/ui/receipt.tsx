"use client";

import { useEffect } from "react";

import { CheckIcon } from "@/components/icons";
import { ArrowLink } from "@/components/ui/link";
import type { ActionReceipt } from "@/lib/actions/shared";

/**
 * What just happened, replacing the form that did it.
 *
 * The inline version was one line of text under a form that had already
 * cleared itself, which left a mentor on a phone unsure whether the tap
 * registered, scrolling up to check. A receipt takes the form's place: it
 * states the outcome, its consequences, and the three things anyone wants next
 * — fix it, do it again, go look at it.
 *
 * "Edit it" comes first on purpose. The moment a mentor reads "90 min" and
 * meant 60 is the moment they can still fix it in one tap, and burying that
 * behind a trip to the student's page is how a wrong number becomes permanent.
 */
export function Receipt({
  receipt,
  correctHref,
  onAgainHref,
  againLabel = "Log another",
}: {
  receipt: ActionReceipt;
  /** Where the just-written row can be edited. */
  correctHref?: string;
  /** The same form, empty. A link rather than a reset, so back still works. */
  onAgainHref?: string;
  againLabel?: string;
}) {
  const { headline, notes, subject } = receipt;

  useEffect(() => {
    // A short confirmation tone supplements the visible receipt after submit.
    const AudioContextClass =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.14);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.15);
    window.setTimeout(() => void context.close(), 250);
  }, []);

  return (
    <div className="rise-in rounded-2xl border border-line bg-surface shadow-sm p-5 sm:p-6">
      <p className="flex items-baseline gap-2 text-[1.0625rem] font-semibold text-ink">
        <CheckIcon className="h-4 w-4 shrink-0 translate-y-0.5" />
        {headline}
      </p>
      {notes.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-muted-fg">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-line pt-3">
        {correctHref && <ArrowLink href={correctHref} className="text-sm">Edit it</ArrowLink>}
        {onAgainHref && (
          <ArrowLink href={onAgainHref} reloadDocument className="text-sm">
            {againLabel}
          </ArrowLink>
        )}
        {subject && (
          <ArrowLink href={`/mentor/students/${subject.id}`} className="text-sm">
            {subject.name}
          </ArrowLink>
        )}
      </div>
    </div>
  );
}
