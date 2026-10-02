"use client";

import { useActionState, useState } from "react";

import { Field, Input, Textarea, inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { setBugStatus } from "@/lib/actions/bugs";
import {
  BUG_RESOLUTION_MAX,
  BUG_STATUS,
  BUG_STATUSES,
  BUG_STATUS_LABELS,
  type BugStatus,
} from "@/lib/bugs";

/**
 * Move a report along. Fixed and Closed ask for words — the fix line is read by
 * every user, the closing note by the person who reported it — and Fixed also
 * takes the changelog day it shipped in, which defaults to today.
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
  const [state, action] = useActionState(setBugStatus, null);
  const [next, setNext] = useState<BugStatus>(status);
  const failed = state && !state.ok ? state : null;
  const fieldError = (name: string) => (failed?.field === name ? failed.error : undefined);
  const closing = next === BUG_STATUS.FIXED || next === BUG_STATUS.CLOSED;

  return (
    <form action={action} className="space-y-4 p-4 sm:p-5">
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
          <Textarea
            name="resolution"
            rows={3}
            maxLength={BUG_RESOLUTION_MAX}
            defaultValue={resolution ?? ""}
          />
        </Field>
      )}

      {next === BUG_STATUS.FIXED && (
        <Field label="Shipped in the changelog on" error={fieldError("changelogDate")} hint="Defaults to today.">
          <Input type="date" name="changelogDate" defaultValue={changelogDate ?? ""} />
        </Field>
      )}

      {failed && !failed.field && (
        <p role="alert" className="text-sm text-danger-ink">
          {failed.error}
        </p>
      )}
      {state?.ok && <p className="text-sm text-muted-fg">{state.message}</p>}

      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}
