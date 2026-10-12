"use client";

import { useState } from "react";

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
 * ordinary case and is one tap, with nothing to fill in — a student who has to
 * write something to agree with a correct row will stop agreeing with correct
 * rows. A rating is given on the Feedback page. Disputing opens a box and
 * requires it: a flag with no words is a flag nobody can act on.
 *
 * Neither answer moves a balance. See `answerSession` — an admin corrects or
 * voids, which is an audited write.
 */
export function SessionAnswerForm({ sessionId }: { sessionId: string }) {
  const [, action, save] = useSaveState(answerSession);
  const [disputing, setDisputing] = useState(false);

  // ONE question per row. The row's own chip already asks it ("Confirm this
  // session"), so the form does not ask it a second time in other words — it
  // offers the two answers, as two equal buttons.
  if (!disputing) {
    return (
      <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="answer" value={SESSION_ANSWER.CONFIRMED} />
        <SubmitButton size="sm" className="max-sm:h-11">
          Yes, it happened
        </SubmitButton>
        <Button
          size="sm"
          variant="secondary"
          className="max-sm:h-11"
          onClick={() => setDisputing(true)}
        >
          Something&apos;s wrong
        </Button>
        <SaveState state={save} />
      </form>
    );
  }

  return (
    <form action={action} className="mt-2 space-y-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="answer" value={SESSION_ANSWER.DISPUTED} />

      <Field label="What was wrong?">
        <Textarea name="studentNote" required rows={3} />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton size="sm" variant="secondary" className="max-sm:h-11">
          Send
        </SubmitButton>
        <Button
          size="sm"
          variant="secondary"
          className="max-sm:h-11"
          onClick={() => setDisputing(false)}
        >
          Cancel
        </Button>
        <SaveState state={save} />
      </div>
    </form>
  );
}
