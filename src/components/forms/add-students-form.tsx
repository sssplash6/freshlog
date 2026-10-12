"use client";

import { useState } from "react";

import { PlusIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Labelled } from "@/components/forms/labelled";
import { Select } from "@/components/select";
import { EmailInput, Input } from "@/components/ui/field";
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
export function AddStudentsForm({
  program,
  defaultOpen = false,
  classHours = false,
}: {
  program: ProgramOption;
  /** Arrive with one row open — a link that said "Add students" landed here. */
  defaultOpen?: boolean;
  /** The program logs hours as classes: rows are groups, a name and a folder. */
  classHours?: boolean;
}) {
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
      <StudentRows
        key={attempt}
        program={program}
        pending={pending}
        classHours={classHours}
        // Only on arrival: after a successful add the form closes, as it always has.
        open={defaultOpen && attempt === 0}
      />
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
  open,
  classHours,
}: {
  program: ProgramOption;
  pending: boolean;
  open: boolean;
  classHours: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(
    open ? [{ id: 0, email: "", first: "", last: "", folderUrl: "" }] : [],
  );
  // Ids only advance in handlers, never during render.
  const [nextId, setNextId] = useState(open ? 1 : 0);
  // In a leveled program the cohort select only offers the level the admin
  // picked — one level, and the pick is already made.
  const [levelId, setLevelId] = useState(
    program.levels.length === 1 ? program.levels[0].id : "",
  );
  const selectedLevel = program.levels.find((l) => l.id === levelId) ?? null;
  const cohorts =
    program.levels.length > 0
      ? (selectedLevel?.cohorts ?? [])
      : program.cohorts;
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
    classHours
      ? r.first.trim() !== ""
      : EMAIL_RE.test(normalizeEmail(r.email)) && fullName(r);
  const validCount = rows.filter(ready).length;

  // Why nothing is ready, for the row somebody has started filling in.
  const started = rows.filter(
    (r) => r.email.trim() || r.first.trim() || r.last.trim(),
  );
  const blocking =
    started.length === 0
      ? null
      : classHours
        ? "Needs a group name"
        : started.some((r) => !EMAIL_RE.test(normalizeEmail(r.email)))
        ? "Needs a valid email"
        : "Needs a first and last name";

  const update = (
    id: number,
    field: "email" | "first" | "last" | "folderUrl",
    value: string,
  ) =>
    setRows((rs) =>
      rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    );

  // THE FORM REPLACES ITS BUTTON. It used to open its rows ABOVE an "Add
  // students" button that stayed on screen under them — two "add" controls,
  // one of which now meant "add another row". Closed, this is the one button;
  // open, it is a card with its own title, the column names, a way to add a
  // row, Cancel, and the submit.
  if (rows.length === 0) {
    return (
      <Button type="button" variant="secondary" onClick={addRow} className="gap-1.5">
        <PlusIcon className="h-4 w-4 shrink-0" />
        {classHours ? "Add group" : "Add students"}
      </Button>
    );
  }

  return (
    <>
      {rows.length > 0 && (
        <div className="space-y-2 rounded-xl bg-surface p-4 shadow-sm sm:p-5">
          <h2 className="mb-1 text-title font-semibold tracking-[-0.01em] text-ink">
            {classHours ? "Add groups" : "Add students"} to {program.name}
          </h2>
          {/* The column names, once, from `sm` up: placeholders alone are not
              labels, and they vanish the moment somebody starts typing. On a
              phone each field carries its own label instead (below). */}
          <div
            aria-hidden="true"
            className={cn("hidden gap-2 text-xs font-medium text-muted-fg sm:grid", ROW_GRID)}
          >
            {classHours ? (
              <span className="col-span-3">Group name</span>
            ) : (
              <>
                <span>Email</span>
                <span>First name</span>
                <span>Last name</span>
              </>
            )}
            <span>Folder link</span>
          </div>
          {rows.map((r, i) => (
            /* One line per row from `sm`, each track as wide as what goes in
               it: the email widest, the names short, the folder link last.
               Below `sm` every field is full width and the remove button sits
               in the row's top-right corner instead of reserving a column. */
            <div key={r.id} className={cn("relative grid gap-2", ROW_GRID)}>
              {classHours ? (
                // A group is a name and nothing else: it takes the three
                // tracks the email and the two names share, so the folder link
                // and the remove button sit exactly where they do for students.
                <label className="block min-w-0 sm:col-span-3">
                  <span className={PHONE_LABEL}>Group name</span>
                  <Input
                    name="groupName"
                    type="text"
                    autoComplete="off"
                    maxLength={NAME_MAX}
                    value={r.first}
                    onChange={(e) => update(r.id, "first", e.target.value)}
                    placeholder="e.g. Tuesday class"
                    aria-label={`Group ${i + 1} name`}
                    autoFocus={i === rows.length - 1}
                  />
                </label>
              ) : (
                <>
              <label className="block min-w-0">
                <span className={PHONE_LABEL}>Email</span>
                <EmailInput
                  name="email"
                  value={r.email}
                  onChange={(e) => update(r.id, "email", e.target.value)}
                  placeholder="student@example.com"
                  aria-label={`Student ${i + 1} email`}
                  autoFocus={i === rows.length - 1}
                />
              </label>
              <label className="block min-w-0">
                <span className={PHONE_LABEL}>First name</span>
                <Input
                  name="firstName"
                  type="text"
                  autoComplete="off"
                  maxLength={NAME_MAX}
                  value={r.first}
                  onChange={(e) => update(r.id, "first", e.target.value)}
                  placeholder="e.g. Malika"
                  aria-label={`Student ${i + 1} first name`}
                />
              </label>
              <label className="block min-w-0">
                <span className={PHONE_LABEL}>Last name</span>
                <Input
                  name="lastName"
                  type="text"
                  autoComplete="off"
                  maxLength={NAME_MAX}
                  value={r.last}
                  onChange={(e) => update(r.id, "last", e.target.value)}
                  placeholder="e.g. Rahimova"
                  aria-label={`Student ${i + 1} last name`}
                />
              </label>
                </>
              )}
              {/* Not type="url": native validation would reject a pasted
                    `drive.google.com/…`, which the action accepts and https-fixes. */}
              <label className="block min-w-0">
                <span className={PHONE_LABEL}>Folder link</span>
                <Input
                  name="folderUrl"
                  type="text"
                  inputMode="url"
                  measure="full"
                  value={r.folderUrl}
                  onChange={(e) => update(r.id, "folderUrl", e.target.value)}
                  aria-label={`${classHours ? "Group" : "Student"} ${i + 1} folder link`}
                />
              </label>
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                aria-label={`Remove ${classHours ? "group" : "student"} ${i + 1}`}
                className="absolute -right-2 -top-2 flex h-11 w-11 items-center justify-center rounded-lg text-muted-fg transition-colors hover:bg-canvas hover:text-danger-ink sm:static sm:w-9"
              >
                <XIcon className="h-4 w-4" />
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
            <div className="flex flex-wrap items-end gap-3">
              {program.levels.length > 0 && (
                <Labelled label="Level" className="w-full sm:w-48">
                  <Select
                    name="levelId"
                    ariaLabel="Level"
                    options={program.levels.map((l) => ({ value: l.id, label: l.name }))}
                    defaultValue={levelId}
                    onChange={setLevelId}
                    measure="sm"
                  />
                </Labelled>
              )}
              {cohorts.length > 0 && (
                <Labelled label="Cohort" className="w-full sm:w-48">
                  {/* `key` remounts it on a level change, so a cohort picked
                      under Emerging cannot be submitted under Advanced. */}
                  <Select
                    key={levelId}
                    name="cohortId"
                    ariaLabel="Cohort"
                    options={cohorts.map((c) => ({ value: c.id, label: c.name }))}
                    defaultValue={cohorts.length === 1 ? cohorts[0].id : ""}
                    measure="sm"
                  />
                </Labelled>
              )}
              <Button type="button" variant="ghost" onClick={() => setRows([])}>
                Cancel
              </Button>
              {/* Grey until something is ready, not a pale blue: a primary
                  button at half opacity read as an active one. */}
              <Button
                type="submit"
                variant={validCount > 0 ? "primary" : "secondary"}
                disabled={pending || validCount === 0}
              >
                {pending
                  ? "Adding…"
                  : validCount > 0
                    ? `Add ${validCount} ${classHours ? "group" : "student"}${validCount === 1 ? "" : "s"}`
                    : classHours
                      ? "Add group"
                      : "Add students"}
              </Button>
            </div>
          </div>
          {/* Another row, from inside the card it adds to. */}
          <Button type="button" variant="ghost" onClick={addRow} className="-ml-2 gap-1.5">
            <PlusIcon className="h-4 w-4 shrink-0" />
            {classHours ? "Another group" : "Another student"}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * The row's tracks from `sm`: email, first name, last name, folder link, and
 * the remove button. A group's name takes the first three.
 */
const ROW_GRID =
  "sm:grid-cols-[minmax(0,16rem)_minmax(0,9rem)_minmax(0,9rem)_minmax(0,16rem)_2.25rem]";

/** A field's name above it on a phone; from `sm` the column headings say it. */
const PHONE_LABEL = "mb-1 block text-xs font-medium text-muted-fg sm:sr-only";
