"use client";

import { useEffect, useRef, useState } from "react";

import { AttendancePicker } from "@/components/forms/attendance-picker";
import { TimeKindPicker } from "@/components/forms/time-kind-picker";
import { useLiveSession } from "@/components/session-live-context";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { Field, GrowingField, Input, inputClasses } from "@/components/ui/field";
import { RowActionGroup, RowActionMenu } from "@/components/ui/row-action-menu";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { attendanceOf, timeKindOf } from "@/lib/constants";
import { toDateInputValue } from "@/lib/format";
import { deleteSession, restoreSession, voidSession } from "@/lib/actions/sessions";
import type { SessionUpdate } from "@/lib/actions/shared";

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
  const [, voidAction, voidSave] = useSaveState(voidSession);
  const [, delAction, delSave] = useSaveState(deleteSession);
  const [, restoreAction, restoreSave] = useSaveState(restoreSession);
  const editFormRef = useRef<HTMLFormElement>(null);
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editPending = useRef<FormData | null>(null);
  const editInFlight = useRef(false);
  const [editStatus, setEditStatus] = useState<"idle" | "saving" | "failed">("idle");
  const [savingField, setSavingField] = useState<string | null>(null);
  const liveSession = useLiveSession();
  const currentMinutes = liveSession?.session.minutes ?? session.minutes;
  const currentDate = liveSession
    ? toDateInputValue(liveSession.session.date)
    : session.date;
  const currentNote = liveSession ? liveSession.session.note : session.note;
  const currentAssignmentId = liveSession
    ? liveSession.session.task?.id
    : session.assignmentId;
  const currentAttendance = liveSession
    ? attendanceOf(liveSession.session)
    : session.attendance;
  const currentTimeKind = liveSession
    ? timeKindOf(liveSession.session)
    : session.timeKind;

  function autosave(event: React.FormEvent<HTMLFormElement>) {
    const target = event.target as HTMLInputElement;
    const field = target.name || null;
    setSavingField(field);
    if (editTimer.current) clearTimeout(editTimer.current);
    editTimer.current = setTimeout(() => {
      if (editFormRef.current) editPending.current = new FormData(editFormRef.current);
      void flushEdit();
    }, 450);
  }

  async function flushEdit() {
    if (editInFlight.current || !editPending.current) return;
    const body = editPending.current;
    editPending.current = null;
    editInFlight.current = true;
    setEditStatus("saving");
    let failed = false;
    try {
      const response = await fetch(`/api/sessions/${session.id}`, {
        method: "PATCH",
        body,
      });
      if (!response.ok) throw new Error("Session could not be saved.");
      const result = (await response.json()) as {
        session?: SessionUpdate;
      };
      if (result.session) liveSession?.update(result.session);
    } catch {
      failed = true;
      setEditStatus("failed");
    } finally {
      editInFlight.current = false;
      if (editPending.current) {
        void flushEdit();
      } else if (!failed) {
        setEditStatus("idle");
        setSavingField(null);
      }
    }
  }

  useEffect(
    () => () => {
      if (editTimer.current) clearTimeout(editTimer.current);
      editPending.current = null;
    },
    [],
  );

  return (
    <RowActionMenu
      trigger="pencil"
      label={canEdit ? "Edit this session" : "Manage this session"}
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
          <form
            ref={editFormRef}
            onSubmit={(event) => event.preventDefault()}
            onChange={autosave}
            aria-busy={editStatus === "saving"}
            data-saving-field={savingField ?? undefined}
            className="autosave-editor space-y-3"
          >
            <input type="hidden" name="sessionId" value={session.id} />

            {goals.length > 0 && (
              <Field label="Agenda item">
                <select
                  name="assignmentId"
                    defaultValue={currentAssignmentId ?? ""}
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
                  inputMode="numeric"
                  min="1"
                  step="1"
                  required
                   defaultValue={currentMinutes}
                />
              </Field>
              <Field label="Date" className="min-w-0 flex-1">
                <Input
                  name="date"
                  type="date"
                  required
                   defaultValue={currentDate}
                />
              </Field>
            </div>

            <Field label="Notes">
              <GrowingField
                name="note"
                 defaultValue={currentNote ?? ""}
                placeholder="What you covered"
              />
            </Field>

            <AttendancePicker
              defaultValue={currentAttendance}
              compact
            />

            <TimeKindPicker defaultValue={currentTimeKind} compact />

          </form>
          {editStatus === "failed" && (
            <p role="alert" className="mt-2 text-sm text-danger-ink">
              This edit could not be saved. Try changing the field again.
            </p>
          )}
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
