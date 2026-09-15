"use client";

import { ConfirmInline } from "@/components/ui/confirm-inline";
import { Field, GrowingField, Input } from "@/components/ui/field";
import { RowActionGroup, RowActionMenu } from "@/components/ui/row-action-menu";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { cancelInterview, rescheduleInterview } from "@/lib/actions/interviews";

/**
 * Move or call off one scheduled meeting — the mentor's own, and only while it
 * is still open. Same shape as the session row's correction menu, because it is
 * the same gesture on the same kind of row.
 *
 * Cancelling asks first, like every destructive action in the app: the student
 * has already been told to turn up, so it is not a click to make twice by
 * accident.
 */
export function MeetingRowActions({
  meeting,
}: {
  meeting: {
    id: string;
    /** YYYY-MM-DD */
    date: string;
    /** HH:MM, or "" when no time was given. */
    time: string;
    link: string | null;
    note: string | null;
  };
}) {
  const [, editAction, editSave] = useSaveState(rescheduleInterview);
  const [, cancelAction, cancelSave] = useSaveState(cancelInterview);

  return (
    <RowActionMenu
      trigger="pencil"
      label="Change this meeting"
      width="lg"
    >
      <RowActionGroup label="Move this meeting">
        <form action={editAction} className="space-y-3">
          <input type="hidden" name="interviewId" value={meeting.id} />

          <div className="flex gap-2">
            <Field label="Date" className="min-w-0 flex-1">
              <Input
                name="date"
                type="date"
                required
                defaultValue={meeting.date}
              />
            </Field>
            <Field label="Time" className="w-28 shrink-0">
              <Input name="time" type="time" defaultValue={meeting.time} />
            </Field>
          </div>

          <Field label="Link">
            <Input
              name="link"
              type="text"
              inputMode="url"
              defaultValue={meeting.link ?? ""}
              placeholder="Meet, Zoom, or where to turn up"
            />
          </Field>

          <Field label="Note">
            <GrowingField
              name="note"
              defaultValue={meeting.note ?? ""}
              placeholder="What it covers"
            />
          </Field>

          <p className="text-xs text-muted-fg">
            A new time asks the student to confirm again.
          </p>

          <SubmitButton size="sm" pendingText="Saving…">
            Save changes
          </SubmitButton>
        </form>
        <SaveState state={editSave} />
      </RowActionGroup>

      <RowActionGroup>
        <ConfirmInline
          variant="quiet"
          action={cancelAction}
          values={{ interviewId: meeting.id }}
          pending={cancelSave.kind === "saving"}
          label="Cancel this meeting"
          question="The student is told it's off."
          confirmLabel="Yes, cancel it"
          cancelLabel="Keep it"
          pendingLabel="Cancelling…"
        />
        <SaveState state={cancelSave} />
      </RowActionGroup>
    </RowActionMenu>
  );
}
