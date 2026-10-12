"use client";

import { useEffect } from "react";

import { CheckIcon } from "@/components/icons";
import { ArrowLink } from "@/components/ui/link";
import type { ActionReceipt } from "@/lib/actions/shared";

/**
 * What just happened, replacing the form that did it: the outcome in one line,
 * and the three things anyone wants next — fix it, do it again, go look at it.
 * No card: one line of data sits on the page (DESIGN.md W5).
 *
 * "Edit it" comes first on purpose. The moment a mentor reads "90 min" and
 * meant 60 is the moment they can still fix it in one tap, and burying that
 * behind a trip to the student's page is how a wrong number becomes permanent.
 */
export function Receipt({
  receipt,
  correctHref,
  onAgain,
  againLabel = "Log another",
  from,
}: {
  receipt: ActionReceipt;
  /** Where the just-written row can be edited. */
  correctHref?: string;
  /** Start the same form again, in place. */
  onAgain?: () => void;
  againLabel?: string;
  /** The program the reader came through, so the student's page still goes back to it. */
  from?: string;
}) {
  const { headline, subject } = receipt;

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
    <div role="status" className="rise-in px-1">
      <p className="flex items-baseline gap-2 text-title font-semibold text-ink">
        <CheckIcon className="h-4 w-4 shrink-0 translate-y-0.5" />
        {headline}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-6">
        {correctHref && <ArrowLink href={correctHref} className="text-sm">Edit it</ArrowLink>}
        {onAgain && (
          <button
            type="button"
            onClick={onAgain}
            // ArrowLink's look: it is the same kind of "next" as its neighbours.
            className="inline-flex min-h-11 items-center text-sm font-medium text-brand hover:underline"
          >
            {againLabel}
          </button>
        )}
        {subject && (
          <ArrowLink href={`/students/${subject.id}${from ? `?from=${encodeURIComponent(from)}` : ""}`} className="text-sm">
            {subject.name}
          </ArrowLink>
        )}
      </div>
    </div>
  );
}
