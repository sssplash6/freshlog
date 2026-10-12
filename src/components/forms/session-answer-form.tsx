"use client";

import { useState } from "react";

import { StarRating } from "@/components/forms/feedback-forms";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { answerSession } from "@/lib/actions/sessions";
import { SESSION_ANSWER } from "@/lib/constants";

/**
 * The student's answer to a session their mentor logged.
 *
 * Until now the hours moved on one party's word: a mentor wrote 90 minutes,
 * the student's balance dropped by 90 minutes, the student was told, and there
 * was nowhere to say "that did not happen" or "it ran thirty". The ledger's
 * promise is that these numbers are trusted by everyone, and trust that cannot
 * be withheld is not trust.
 *
 * Two doors, and they are deliberately not the same size. Confirming is the
 * ordinary case and is one tap — a rating and a word are offered underneath and
 * neither is required, because a student who has to write something to agree
 * with a correct row will stop agreeing with correct rows. Disputing opens a
 * box and requires it: a flag with no words is a flag nobody can act on.
 *
 * Neither answer moves a balance. See `answerSession` — an admin corrects or
 * voids, which is an audited write.
 */
export function SessionAnswerForm({
  sessionId,
  mentorName,
}: {
  sessionId: string;
  mentorName: string;
}) {
  const [, action, save] = useSaveState(answerSession);
  const [mode, setMode] = useState<"ask" | "confirm" | "dispute">("ask");

  // ONE question per row. The row's own chip already asks it ("Confirm this
  // session"), so the form does not ask it a second time in other words — it
  // offers the two answers. Both are buttons: the dispute was grey link text,
  // which read as an aside rather than as one of two equal choices, and at
  // 13px it was the smaller target of the pair on a phone.
  if (mode === "ask") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" className="max-sm:h-11" onClick={() => setMode("confirm")}>
          Yes, it happened
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="max-sm:h-11"
          onClick={() => setMode("dispute")}
        >
          Something&apos;s wrong
        </Button>
      </div>
    );
  }

  const disputing = mode === "dispute";

  return (
    <form action={action} className="mt-2 space-y-3 rounded-xl bg-canvas p-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input
        type="hidden"
        name="answer"
        value={disputing ? SESSION_ANSWER.DISPUTED : SESSION_ANSWER.CONFIRMED}
      />

      {disputing ? (
        <Field
          label="What was wrong?"
          hint={`${mentorName} and your program will see this.`}
        >
          <Textarea
            name="studentNote"
            required
            rows={3}
            placeholder="It ran 30 minutes, not 60."
          />
        </Field>
      ) : (
        <>
          {/* Both optional. The rating is on THIS meeting and only your
              program's staff see it: ratings are anonymous to mentors
              (October 2026), here as on the feedback page. */}
          <StarRating
            name="studentRating"
            idPrefix={`session-${sessionId}`}
            legend="How did it go?"
            required={false}
          />
          <Field label="Anything to add?" hint="Optional. Your mentor won't see your rating or this note.">
            <Textarea name="studentNote" rows={2} placeholder="" />
          </Field>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton size="sm" variant={disputing ? "secondary" : "primary"}>
          {disputing ? "Send" : "Confirm"}
        </SubmitButton>
        <button
          type="button"
          onClick={() => setMode("ask")}
          className="inline-flex min-h-10 items-center text-xs font-medium text-muted-fg transition-colors hover:text-ink"
        >
          Cancel
        </button>
        <SaveState state={save} />
      </div>
    </form>
  );
}
