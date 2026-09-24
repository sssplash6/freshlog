"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { EmailInput, Input, inputClasses } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { createStudents } from "@/lib/actions/students";
import {
  EMAIL_RE,
  FULL_NAME_RE,
  NAME_MAX,
  normalizeEmail,
  type ActionState,
} from "@/lib/actions/shared";
import { cn } from "@/lib/cn";
import type { ProgramOption } from "@/lib/queries";

type Row = {
  id: number;
  email: string;
  first: string;
  last: string;
  folderUrl: string;
};

/**
 * Staff registers students into ONE program: an email, a first name, a last
 * name and an optional folder link each, with a cohort asked for only in the
 * programs that have them.
 *
 * TWO NAME FIELDS, not one. A single box labelled "First and last name" is a
 * box people put one word in, and the app then holds a roster on which two
 * Malikas cannot be told apart. The two halves are joined server-side into the
 * one string `User.name` holds, and a row with only one half is refused by the
 * same rule the student meets at their own first sign-in.
 *
 * THE BUTTON IS THE FORM. It starts as one full-width "Add students" and
 * nothing else; each tap opens a row ABOVE it, so the list grows up out of the
 * control that made it and the button stays where the thumb left it. It was a
 * fold that opened two rows at once with a "+ Add another student" link buried
 * under them — two controls for one gesture, and the second one three taps down
 * a phone screen.
 *
 * No instructions anywhere: not what the fields want, not what happens on the
 * student's first sign-in. The placeholders say what to type, and the line
 * beside the submit says what is still missing once somebody has started.
 */
export function AddStudentsForm({ program }: { program: ProgramOption }) {
  // Empty rows after a successful add, without an effect that re-renders to do
  // it: the wrapped action bumps a counter, and the counter is the child's
  // `key`, so React discards the filled-in rows and mounts blank ones. Setting
  // state inside the action is an ordinary update — setting it in an effect
  // body is the cascade react-hooks/set-state-in-effect warns about, and it
  // also painted the submitted values once before clearing them.
  const [attempt, setAttempt] = useState(0);
  const [, action, save] = useSaveState(
    async (previous: ActionState, formData: FormData) => {
      const result = await createStudents(previous, formData);
      if (result?.ok) setAttempt((n) => n + 1);
      return result;
    },
  );
  const pending = save.kind === "saving";

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="programId" value={program.id} />
      <StudentRows key={attempt} program={program} pending={pending} />
      <SaveState state={save} />
    </form>
  );
}

/**
 * The rows themselves, plus everything whose value depends on them. Its own
 * component so that a change of `key` is all it takes to clear the form — which
 * also closes it, since no rows is the closed state.
 */
function StudentRows({
  program,
  pending,
}: {
  program: ProgramOption;
  pending: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  // Ids only advance in handlers, never during render.
  const [nextId, setNextId] = useState(0);
  const addRow = () => {
    setRows((rs) => [
      ...rs,
      { id: nextId, email: "", first: "", last: "", folderUrl: "" },
    ]);
    setNextId((n) => n + 1);
  };

  // A row is ready when it has both halves of an identity: the address they
  // sign in with, and the FULL name everyone will read them by — the same rule
  // `parseNameField` holds the server side to, applied to the two boxes joined
  // exactly as the action will join them.
  const fullName = (r: Row) =>
    FULL_NAME_RE.test(`${r.first} ${r.last}`.trim().replace(/\s+/g, " "));
  const ready = (r: Row) =>
    EMAIL_RE.test(normalizeEmail(r.email)) && fullName(r);
  const validCount = rows.filter(ready).length;

  // Why nothing is ready, for the row somebody has started filling in.
  const started = rows.filter(
    (r) => r.email.trim() || r.first.trim() || r.last.trim()
  );
  const blocking =
    started.length === 0
      ? null
      : started.some((r) => !EMAIL_RE.test(normalizeEmail(r.email)))
        ? "Every row needs a valid email address."
        : "Every row needs a first and last name.";

  const update = (
    id: number,
    field: "email" | "first" | "last" | "folderUrl",
    value: string,
  ) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

  return (
    <>
      {rows.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
          {rows.map((r, i) => (
            <div key={r.id} className="flex items-start gap-2">
              <div className="grid flex-1 gap-2 sm:grid-cols-4">
                <EmailInput
                  name="email"
                  value={r.email}
                  onChange={(e) => update(r.id, "email", e.target.value)}
                  placeholder="student@example.com"
                  aria-label={`Student ${i + 1} email`}
                  autoFocus={i === rows.length - 1}
                />
                <Input
                  name="firstName"
                  type="text"
                  autoComplete="off"
                  maxLength={NAME_MAX}
                  value={r.first}
                  onChange={(e) => update(r.id, "first", e.target.value)}
                  placeholder="First name"
                  aria-label={`Student ${i + 1} first name`}
                />
                <Input
                  name="lastName"
                  type="text"
                  autoComplete="off"
                  maxLength={NAME_MAX}
                  value={r.last}
                  onChange={(e) => update(r.id, "last", e.target.value)}
                  placeholder="Last name"
                  aria-label={`Student ${i + 1} last name`}
                />
                {/* Not type="url": native validation would reject a pasted
                    `drive.google.com/…`, which the action accepts and https-fixes. */}
                <Input
                  name="folderUrl"
                  type="text"
                  inputMode="url"
                  value={r.folderUrl}
                  onChange={(e) => update(r.id, "folderUrl", e.target.value)}
                  placeholder="Student folder (link)"
                  aria-label={`Student ${i + 1} folder link`}
                />
              </div>
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                aria-label={`Remove student ${i + 1}`}
                className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-muted-fg transition-colors hover:bg-canvas hover:text-danger-ink"
              >
                ✕
              </button>
            </div>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {/* A disabled button with no reason beside it is how "the name
                field wants a surname" gets invented: the admin types one word,
                nothing happens, and they guess. Say which half is missing —
                and only once they have started, so an empty row is never told
                off for being empty. */}
            <p className="text-xs text-muted-fg" aria-live="polite">
              {validCount > 0 ? (
                <>
                  <span className="font-medium tabular-nums text-ink">
                    {validCount}
                  </span>{" "}
                  ready to add
                </>
              ) : (
                blocking
              )}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {program.cohorts.length > 0 && (
                <label className="flex items-center gap-2 text-sm text-muted-fg">
                  Cohort
                  <select
                    name="cohortId"
                    required
                    defaultValue={
                      program.cohorts.length === 1 ? program.cohorts[0].id : ""
                    }
                    className={cn(inputClasses, "w-auto")}
                  >
                    <option value="" disabled>
                      Select…
                    </option>
                    {program.cohorts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button type="submit" disabled={pending || validCount === 0}>
                {pending
                  ? "Adding…"
                  : validCount > 0
                    ? `Add ${validCount} student${validCount === 1 ? "" : "s"}`
                    : `Add to ${program.name}`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Under the rows it opens, at the width of the page. The plus is what
          says a tap adds one more; the label never changes, so the control a
          reader learned on their first visit is the control they come back to. */}
      <Button
        type="button"
        variant="secondary"
        onClick={addRow}
        className="w-full"
      >
        + Add students
      </Button>
    </>
  );
}
