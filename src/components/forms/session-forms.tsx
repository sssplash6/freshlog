"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { AttendancePicker } from "@/components/forms/attendance-picker";
import { TimeKindPicker } from "@/components/forms/time-kind-picker";
import { useLiveSession } from "@/components/session-live-context";
import { toast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { DateField } from "@/components/ui/date-field";
import { Select } from "@/components/select";
import { Field, GrowingField, Input, MEASURE } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { RowActionGroup, RowActionMenu } from "@/components/ui/row-action-menu";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { attendanceOf, timeKindOf } from "@/lib/constants";
import { formatDate, toDateInputValue } from "@/lib/format";
import { programToday } from "@/lib/when";
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
  student,
  mentor,
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
  /**
   * Who this row is about, for the trigger's accessible name. A log of forty
   * rows has forty identical pencils; the panel opens beside its own row, so
   * the row itself says whose session it holds.
   */
  student?: string | null;
  mentor?: string | null;
}) {
  const [voiding, startVoid] = useTransition();
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
    queueSave(target.name || null);
  }

  function queueSave(field: string | null) {
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

  const who = [student, mentor ? `with ${mentor}` : null]
    .filter(Boolean)
    .join(" ");
  const when = formatDate(new Date(`${currentDate}T00:00:00Z`));

  return (
    <RowActionMenu
      trigger="pencil"
      // "Edit it" on a receipt lands here with `?edit=<id>`: the panel it
      // promised is open, rather than a list to find the pencil in.
      openOnArrival={() =>
        canEdit && new URLSearchParams(window.location.search).get("edit") === session.id
      }
      label={`${canEdit ? "Edit this session" : "Manage this session"}${
        who ? `: ${who}, ${when}` : ""
      }`}
      // A small form, not a list of verbs: at w-80 its two-word segment
      // labels wrapped and the panel ran ~800px tall.
      width="xl"
    >
      {() => (
        <>
      {!canEdit && (
        <RowActionGroup label="Voided">
          {/* Void's inverse, which did not exist: a voided row could not be
              corrected and could not be un-voided, so the fix for one mis-tap
              was to delete the record and log it again from memory. */}
          <form action={restoreAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <SubmitButton size="sm" variant="secondary">
              Restore
            </SubmitButton>
            <SaveState state={restoreSave} />
          </form>
        </RowActionGroup>
      )}

      {canEdit && (
        <RowActionGroup>
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
              // The app's own Select, not a native <select>: the OS chevron
              // and menu were the one foreign control among this panel's
              // fills. Its value lives in a hidden input, which raises no
              // `change` for the form's autosave, so it says so itself — the
              // same arrangement the date field below has.
              <div className="space-y-1.5">
                <span className="block text-sm font-medium text-ink">Agenda item</span>
                <Select
                  name="assignmentId"
                  ariaLabel="Agenda item"
                  defaultValue={currentAssignmentId ?? ""}
                  // Blank keeps whatever the session already has, so fixing
                  // the hours never forces a task onto a row without one.
                  options={[{ value: "", label: "Leave unchanged" }, ...goals]}
                  onChange={() => queueSave("assignmentId")}
                />
              </div>
            )}

            <div className="flex flex-wrap items-end gap-3">
              {/* Text with a numeric keypad, as on Log a session: no spinner,
                  and no scroll-wheel nudge taken as an edit. */}
              <Field label="Minutes" className={cn("w-full min-w-0", MEASURE.xs)}>
                <Input
                  name="minutes"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  measure="xs"
                  required
                  defaultValue={currentMinutes}
                />
              </Field>
              {/* A div, not a `Field` (a <label>): the date field's trigger is
                  a button, and a label around it would toggle the calendar on
                  every click of the word. Its value is a hidden input, which
                  raises no `change` for the form's autosave, so it says so
                  itself. */}
              <div className={cn("w-full min-w-0 space-y-1.5", MEASURE.sm)}>
                <span className="block text-sm font-medium text-ink">Date</span>
                <DateField
                  name="date"
                  label="Date"
                  required
                  max={programToday()}
                  defaultValue={currentDate}
                  onChange={() => queueSave("date")}
                />
              </div>
            </div>

            <Field label="Notes">
              <GrowingField name="note" defaultValue={currentNote ?? ""} />
            </Field>

            <AttendancePicker
              defaultValue={currentAttendance}
              compact
            />

            <TimeKindPicker defaultValue={currentTimeKind} compact />

          </form>
          {/* There is no Save and no Done: every change saves a moment after
              it is made, and the menu closes the way any menu does. Only the
              save in flight, or the one that failed, is said. */}
          <p aria-live="polite" className="mt-2 min-h-4 text-xs">
            {editStatus === "failed" ? (
              <span role="alert" className="text-danger-ink">
                Not saved. Try again.
              </span>
            ) : editStatus === "saving" ? (
              <span className="text-muted-fg">Saving…</span>
            ) : null}
          </p>
        </RowActionGroup>
      )}

      {canEdit && (
        <RowActionGroup>
          {/* One tap, then Undo. Voiding has an exact inverse —
              `restoreSession` charges the same row again — so it no longer
              asks first; it does it, says so, and offers to take it back.
              Delete below has no inverse and keeps its confirm. */}
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={voiding}
            aria-busy={voiding || undefined}
            onClick={() => {
              const formData = new FormData();
              formData.set("sessionId", session.id);
              startVoid(async () => {
                const result = await voidSession(null, formData);
                if (!result?.ok) {
                  toast({
                    tone: "error",
                    message: result?.error ?? "That session could not be voided.",
                  });
                  return;
                }
                toast({
                  message: result.message ?? "Session voided; hours returned.",
                  action: {
                    label: "Undo",
                    run: async () => {
                      const undone = await restoreSession(null, formData);
                      if (!undone?.ok) throw new Error(undone?.error);
                    },
                  },
                });
              });
            }}
          >
            {voiding ? "Voiding…" : "Void"}
          </Button>
        </RowActionGroup>
      )}

      {canDelete && (
        <RowActionGroup>
          <ConfirmInline
            variant="quiet"
            action={delAction}
            values={{ sessionId: session.id }}
            pending={delSave.kind === "saving"}
            label="Delete"
            question="Delete this session?"
            confirmLabel="Yes, delete it"
            pendingLabel="Deleting…"
          />
          <SaveState state={delSave} />
        </RowActionGroup>
      )}
        </>
      )}
    </RowActionMenu>
  );
}
