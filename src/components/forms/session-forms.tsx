"use client";

import { AttendancePicker } from "@/components/forms/attendance-picker";
import { TimeKindPicker } from "@/components/forms/time-kind-picker";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { Field, GrowingField, Input, inputClasses } from "@/components/ui/field";
import { RowActionGroup, RowActionMenu } from "@/components/ui/row-action-menu";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  deleteSession,
  editSession,
  restoreSession,
  voidSession,
} from "@/lib/actions/sessions";

/**
 * Edit, void or remove one logged session. A mentor gets this on their own
 * rows; an admin gets it on every row, plus Delete.
 *
 * The verb is "Edit". It was "Correct", which is what the act is called in the
 * product's own vocabulary — a session is a ledger line and correcting one is
 * a deliberate word — but the pencil beside a row is read in half a second,
 * and the word everybody already knows for a pencil is Edit.
 *
 * Void and delete are different tools on purpose. Voiding keeps the row and
 * hands the hours back — the meeting is part of the history even though it
 * didn't count. Deleting is for a row that should never have been there: a
 * duplicate the import brought in twice, a meeting logged on the wrong student.
 */
export function SessionRowActions({
  session,
  goals = [],
  canEdit = true,
  canDelete = false,
}: {
  session: {
    id: string;
    minutes: number;
    date: string;
    /** One of the four states in lib/constants.ts ATTENDANCE. */
    attendance: string;
    /** PLAN or EXTRA — see TIME_KIND. Correctable, since a mis-tick here moves
     *  hours into or out of the student's balance. */
    timeKind: string;
    note: string | null;
    assignmentId: string | null;
  };
  /** The tasks of the mentor who ran this session, so a mis-pick is fixable. */
  goals?: { value: string; label: string }[];
  /** False for a voided row: its hours are already back, so only delete is left. */
  canEdit?: boolean;
  /** Admins only: remove the row outright rather than voiding it. */
  canDelete?: boolean;
}) {
  const [, editAction, editSave] = useSaveState(editSession);
  const [, voidAction, voidSave] = useSaveState(voidSession);
  const [, delAction, delSave] = useSaveState(deleteSession);
  const [, restoreAction, restoreSave] = useSaveState(restoreSession);

  return (
    <RowActionMenu
      trigger="pencil"
      label={canEdit ? "Edit this session" : "Manage this session"}
      verb={canEdit ? "Edit" : "Manage"}
      width="lg"
    >
      {!canEdit && (
        <RowActionGroup label="This session is voided">
          <p className="text-xs text-muted-fg">
            Its hours went back to the balance. Restoring charges them again;
            correcting it is only possible once it counts.
          </p>
          {/* Void's inverse, which did not exist: a voided row could not be
              corrected and could not be un-voided, so the fix for one mis-tap
              was to delete the record and log it again from memory. */}
          <form action={restoreAction} className="mt-2">
            <input type="hidden" name="sessionId" value={session.id} />
            <SubmitButton size="sm" variant="secondary">
              Restore it
            </SubmitButton>
            <SaveState state={restoreSave} />
          </form>
        </RowActionGroup>
      )}

      {canEdit && (
        <RowActionGroup label="Edit this session">
          <form action={editAction} className="space-y-3">
            <input type="hidden" name="sessionId" value={session.id} />

            {goals.length > 0 && (
              <Field label="Agenda item">
                <select
                  name="assignmentId"
                  defaultValue={session.assignmentId ?? ""}
                  className={inputClasses}
                >
                  {/* Blank keeps whatever the session already has, so fixing
                      the hours never forces a task onto a row without one. */}
                  <option value="">Leave unchanged</option>
                  {goals.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <div className="flex gap-2">
              <Field label="Minutes" className="w-28 shrink-0">
                <Input
                  name="minutes"
                  type="number"
                  min="1"
                  step="1"
                  required
                  defaultValue={session.minutes}
                />
              </Field>
              <Field label="Date" className="min-w-0 flex-1">
                <Input
                  name="date"
                  type="date"
                  required
                  defaultValue={session.date}
                />
              </Field>
            </div>

            <Field label="Notes">
              <GrowingField
                name="note"
                defaultValue={session.note ?? ""}
                placeholder="What you covered"
              />
            </Field>

            <AttendancePicker defaultValue={session.attendance} compact />

            <TimeKindPicker defaultValue={session.timeKind} compact />

            <SubmitButton size="sm" pendingText="Saving…">
              Save changes
            </SubmitButton>
          </form>
          <SaveState state={editSave} />
        </RowActionGroup>
      )}

      {canEdit && (
        <RowActionGroup>
          <ConfirmInline
            variant="quiet"
            action={voidAction}
            values={{ sessionId: session.id }}
            pending={voidSave.kind === "saving"}
            label="Void session — keeps the row, returns the hours"
            question="The hours return to the student's balance."
            confirmLabel="Yes, void it"
            pendingLabel="Voiding…"
          />
          <SaveState state={voidSave} />
        </RowActionGroup>
      )}

      {canDelete && (
        <RowActionGroup>
          <ConfirmInline
            variant="quiet"
            action={delAction}
            values={{ sessionId: session.id }}
            pending={delSave.kind === "saving"}
            label="Delete this session"
            question="Removes the row entirely. Void it instead if the meeting really happened."
            confirmLabel="Yes, delete it"
            pendingLabel="Deleting…"
          />
          <SaveState state={delSave} />
        </RowActionGroup>
      )}
    </RowActionMenu>
  );
}
