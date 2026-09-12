"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, NameInput, inputClasses } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { createStudents } from "@/lib/actions/students";
import {
  EMAIL_RE,
  FULL_NAME_RE,
  normalizeEmail,
  type ActionState,
} from "@/lib/actions/shared";
import { cn } from "@/lib/cn";
import type { ProgramOption } from "@/lib/queries";

type Row = { id: number; email: string; name: string; folderUrl: string };

/**
 * Staff registers students into ONE program by entering an email + full name
 * (first and last) + optional student-folder link per student (a cohort is only asked for in
 * programs that have them). Extra rows are added on demand; each student still
 * confirms their name and Telegram username on first sign-in, so the name here
 * is a helpful default.
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
 * component so that a change of `key` is all it takes to clear the form.
 */
function StudentRows({
  program,
  pending,
}: {
  program: ProgramOption;
  pending: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([
    { id: 0, email: "", name: "", folderUrl: "" },
    { id: 1, email: "", name: "", folderUrl: "" },
  ]);
  // Ids only advance in handlers, never during render.
  const [nextId, setNextId] = useState(2);
  const addRow = () => {
    setRows((rs) => [...rs, { id: nextId, email: "", name: "", folderUrl: "" }]);
    setNextId((n) => n + 1);
  };

  // A row is ready when it has both halves of an identity: the address they
  // sign in with, and the FULL name everyone will read them by. First and
  // last, the same rule `parseNameField` holds the server side to — a roster
  // of first names is a roster on which nobody can tell two Malikas apart.
  const fullName = (raw: string) => FULL_NAME_RE.test(raw.trim().replace(/\s+/g, " "));
  const ready = (r: Row) =>
    EMAIL_RE.test(normalizeEmail(r.email)) && fullName(r.name);
  const validCount = rows.filter(ready).length;

  // Why nothing is ready, for the row somebody has started filling in.
  const started = rows.filter((r) => r.email.trim() || r.name.trim());
  const blocking =
    started.length === 0
      ? null
      : started.some((r) => !EMAIL_RE.test(normalizeEmail(r.email)))
        ? "Every row needs a valid email address."
        : "Every row needs a first and last name.";

  const update = (
    id: number,
    field: "email" | "name" | "folderUrl",
    value: string,
  ) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

  return (
    <>
      <div className="space-y-2">
        {/* No heading: the control that opened this form is the words "Add
            students", one line above. */}
        {rows.map((r, i) => (
          <div key={r.id} className="flex items-start gap-2">
            <div className="grid flex-1 gap-2 sm:grid-cols-3">
              <Input
                name="email"
                type="email"
                value={r.email}
                onChange={(e) => update(r.id, "email", e.target.value)}
                placeholder="student@example.com"
                aria-label={`Student ${i + 1} email`}
              />
              <NameInput
                name="name"
                value={r.name}
                onChange={(e) => update(r.id, "name", e.target.value)}
                placeholder="First and last name"
                aria-label={`Student ${i + 1} name`}
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
              disabled={rows.length === 1}
              aria-label={`Remove student ${i + 1}`}
              className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-muted-fg transition-colors hover:bg-canvas hover:text-danger-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-fg"
            >
              ✕
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <button
            type="button"
            onClick={addRow}
            className="text-sm font-medium text-brand transition-colors hover:text-brand-dark"
          >
            + Add another student
          </button>
          <p className="text-xs text-muted-fg">
            Email and name are both needed; one word is a name. The folder link
            is optional — paste the student&apos;s Drive or Docs URL and their
            mentors can open it from their page.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* A disabled button with no reason beside it is how "the name field
            wants a surname" gets invented: the admin types one word, nothing
            happens, and they guess. Say which half is missing. */}
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
    </>
  );
}
