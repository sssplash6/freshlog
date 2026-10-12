"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Field, Textarea, inputClasses } from "@/components/ui/field";
import { setBugStatus } from "@/lib/actions/bugs";
import type { ActionState } from "@/lib/actions/shared";
import {
  BUG_RESOLUTION_MAX,
  BUG_STATUS,
  BUG_STATUSES,
  BUG_STATUS_LABELS,
  resolutionPrefill,
  type BugStatus,
} from "@/lib/bugs";

/**
 * Move a report along. Fixed and Closed ask for words — the fix line is read by
 * every user, the closing note by the person who reported it — and Fixed also
 * takes the changelog day it shipped in, which defaults to today.
 *
 * It submits from a handler and not through `<form action>`, on purpose. React
 * resets a form action's fields when the action settles; the status select is
 * controlled by state, so the reset put its on-screen value back to the first
 * option while state still held the admin's choice. The next save then sent
 * whatever the DOM said — a report an admin had just set to Fixed went back to
 * Pending, "Saved." and all. Nothing here is ever reset behind the state's back.
 */
export function BugTriageForm({
  id,
  status,
  resolution,
  changelogDate,
}: {
  id: string;
  status: BugStatus;
  resolution: string | null;
  changelogDate: string | null;
}) {
  const [state, setState] = useState<ActionState>(null);
  const [saving, startSaving] = useTransition();
  const [next, setNext] = useState<BugStatus>(status);
  const failed = state && !state.ok ? state : null;
  const fieldError = (name: string) => (failed?.field === name ? failed.error : undefined);
  const closing = next === BUG_STATUS.FIXED || next === BUG_STATUS.CLOSED;

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startSaving(async () => {
      setState(await setBugStatus(null, data));
    });
  }

  return (
    <form onSubmit={save} className="space-y-4 p-4 sm:p-5">
      <input type="hidden" name="id" value={id} />

      <Field label="Status">
        <select
          name="status"
          value={next}
          onChange={(event) => setNext(event.target.value as BugStatus)}
          className={inputClasses}
        >
          {BUG_STATUSES.map((s) => (
            <option key={s} value={s}>
              {BUG_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>

      {closing && (
        <Field
          label={next === BUG_STATUS.FIXED ? "Fix line" : "Note to the reporter"}
          required
          error={fieldError("resolution")}
          hint={
            next === BUG_STATUS.FIXED
              ? "Everybody reads this. Write it like a changelog line, with no names."
              : "Only the reporter reads this."
          }
        >
          {/* Keyed on the status, so switching between Fixed and Closed opens
              an empty box instead of carrying the other kind's words across. */}
          <Textarea
            key={next}
            name="resolution"
            rows={3}
            maxLength={BUG_RESOLUTION_MAX}
            defaultValue={resolutionPrefill(next, status, resolution)}
          />
        </Field>
      )}

      {next === BUG_STATUS.FIXED && (
        <Field label="Shipped in the changelog on" error={fieldError("changelogDate")} hint="Defaults to today.">
          <DateField name="changelogDate" label="Shipped on" defaultValue={changelogDate ?? ""} />
        </Field>
      )}

      {failed && !failed.field && (
        <p role="alert" className="text-sm text-danger-ink">
          {failed.error}
        </p>
      )}
      {state?.ok && <p className="text-sm text-muted-fg">{state.message}</p>}

      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
