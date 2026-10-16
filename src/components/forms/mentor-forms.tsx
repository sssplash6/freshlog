"use client";

import { useState } from "react";

import { ProgramTargetsPicker } from "@/components/forms/program-targets-picker";
import { RosterImport } from "@/components/forms/roster-import";
import { useAutosave } from "@/components/forms/use-autosave";
import { UsersIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmailInput, Field, Input, NameInput } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { createMentor, createMentors, updateMentor } from "@/lib/actions/mentors";
import { EMAIL_RE, FULL_NAME_RE, NAME_MAX, normalizeEmail, type ActionState } from "@/lib/actions/shared";
import type { ProgramOption } from "@/lib/queries";
import type { ImportedPerson } from "@/lib/roster-import";

/**
 * The two writes an admin makes about a mentor: register one, and change where
 * they work.
 *
 * They were `create-mentor-form.tsx` and the edit half of `mentor-list.tsx`,
 * and what was wrong with the second is where it lived rather than what it did.
 * It was an inline editor on EVERY row of the mentors list, so a page of
 * twenty-five mentors mounted twenty-five `ProgramTargetsPicker`s over the same
 * program list — the N+1 §6.10 names — and the list, which is a place to scan,
 * was also the only place to edit. Editing a mentor is a thing you do to ONE
 * mentor, so it happens on that mentor's own page.
 *
 * REDESIGN.md §5.2 files both of these under `forms/people-forms.tsx`, together
 * with the student halves. That merge cannot land here: its rule is that a file
 * merge only lands in the commit that rewrites its call sites, and the student
 * forms' call sites belong to commits 40 and 41.
 */

/**
 * Register a mentor: an email, a first and last name, and the programs they
 * work in.
 *
 * The mentor signs in with Google against that email afterwards and sets their
 * own booking links; nothing here can set one, because a link is per pairing
 * and belongs to the person whose calendar it opens.
 */
export function RegisterMentorForm({ programs }: { programs: ProgramOption[] }) {
  const [, action, save] = useSaveState(createMentor);
  const [errors, setErrors] = useState<RegisterErrors>({});
  const errorCount = Object.keys(errors).length;
  // A new intake of mentors arrives as a list; the same card takes the list.
  const [many, setMany] = useState(false);
  if (many) return <RegisterMentorsForm programs={programs} onOne={() => setMany(false)} />;

  return (
    <form
      action={action}
      // The form checks itself, every field at once, in one voice — the
      // pattern Log a session uses. Email answered in Chrome's bubble while
      // Programs answered in red under its legend, two voices on one submit
      // (October 2026).
      noValidate
      onSubmit={(event) => {
        const form = event.currentTarget;
        const found = checkRegister(new FormData(form));
        // `checkValidity` fires `invalid` on each failing control without a
        // bubble; the program picker listens for it and marks itself.
        const valid = form.checkValidity();
        if (Object.keys(found).length > 0 || !valid) {
          event.preventDefault();
          setErrors(found);
        } else {
          setErrors({});
        }
      }}
      onChange={(event) => {
        const name = (event.target as unknown as HTMLInputElement).name;
        if (name in errors) {
          setErrors((prev) => {
            const next = { ...prev };
            delete next[name as keyof RegisterErrors];
            return next;
          });
        }
      }}
      className="rounded-xl bg-surface shadow-sm p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Email"
          required
          hint="The mentor signs in with this address."
          error={errors.email}
        >
          <EmailInput
            name="email"
            required
            placeholder="mentor@example.com"
            aria-invalid={Boolean(errors.email) || undefined}
            className={errors.email ? invalidClass : undefined}
          />
        </Field>
      </div>
      {/* Two boxes, not one: a box labelled "Full name" is a box people put one
          word in. `createMentor` joins them, the same as the students form. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="First name" required error={errors.firstName}>
          <Input
            name="firstName"
            type="text"
            required
            autoComplete="off"
            maxLength={NAME_MAX}
            aria-invalid={Boolean(errors.firstName) || undefined}
            className={errors.firstName ? invalidClass : undefined}
          />
        </Field>
        <Field label="Last name" required error={errors.lastName}>
          <Input
            name="lastName"
            type="text"
            required
            autoComplete="off"
            maxLength={NAME_MAX}
            aria-invalid={Boolean(errors.lastName) || undefined}
            className={errors.lastName ? invalidClass : undefined}
          />
        </Field>
      </div>
      <ProgramTargetsPicker programs={programs} legend="Programs" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={() => setMany(true)} className="-ml-2 gap-1.5">
          <UsersIcon className="h-4 w-4 shrink-0" />
          Register several from a list
        </Button>
        <SubmitButton pendingText="Registering…">Register mentor</SubmitButton>
      </div>
      {errorCount > 0 ? (
        <p role="alert" className="mt-2 text-xs font-medium text-danger-ink">
          {errorCount === 1 ? "Fix the field marked above." : `Fix the ${errorCount} fields marked above.`}
        </p>
      ) : (
        <SaveState state={save} />
      )}
    </form>
  );
}

type MentorRow = { id: number; email: string; first: string; last: string };

/**
 * Register a LIST of mentors into the same programs: rows typed, pasted from
 * a spreadsheet or imported from a file, each read before the one submit
 * registers them all. A row the action cannot register is skipped and named
 * in its answer; the rest still go in.
 */
function RegisterMentorsForm({
  programs,
  onOne,
}: {
  programs: ProgramOption[];
  onOne: () => void;
}) {
  const blank = (id: number): MentorRow => ({ id, email: "", first: "", last: "" });
  const [rows, setRows] = useState<MentorRow[]>([blank(0)]);
  const [nextId, setNextId] = useState(1);
  // Bumped on success: the picker's `key`, so its chips clear with its boxes.
  const [attempt, setAttempt] = useState(0);
  const [, action, save] = useSaveState(async (previous: ActionState, formData: FormData) => {
    const result = await createMentors(previous, formData);
    if (result?.ok) {
      setRows([blank(nextId)]);
      setNextId((n) => n + 1);
      setAttempt((n) => n + 1);
    }
    return result;
  });
  const pending = save.kind === "saving";

  const ready = (r: MentorRow) =>
    EMAIL_RE.test(normalizeEmail(r.email)) &&
    FULL_NAME_RE.test(`${r.first} ${r.last}`.trim().replace(/\s+/g, " "));
  const count = rows.filter(ready).length;
  const started = rows.filter((r) => r.email.trim() || r.first.trim() || r.last.trim());
  const blocking =
    started.length === 0
      ? null
      : started.some((r) => !EMAIL_RE.test(normalizeEmail(r.email)))
        ? "Every row needs a valid email address."
        : "Every row needs a first and last name.";

  const update = (id: number, field: "email" | "first" | "last", value: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  const addRow = () => {
    setRows((rs) => [...rs, blank(nextId)]);
    setNextId((n) => n + 1);
  };
  // Imported rows take the place of rows nobody has started, as on the
  // students form.
  const importPeople = (people: ImportedPerson[]) => {
    setRows((rs) => [
      ...rs.filter((r) => r.email.trim() || r.first.trim() || r.last.trim()),
      ...people.map((p, i) => ({ id: nextId + i, email: p.email, first: p.first, last: p.last })),
    ]);
    setNextId((n) => n + people.length);
  };

  return (
    <form
      action={action}
      noValidate
      // The program picker marks itself on `invalid`; nothing else here is
      // left to the browser, since the count beside the button already says
      // which rows are not ready.
      onSubmit={(event) => {
        if (!event.currentTarget.checkValidity() || count === 0) event.preventDefault();
      }}
      className="space-y-2 rounded-xl bg-surface p-4 shadow-sm"
    >
      <div
        aria-hidden="true"
        className="hidden gap-2 text-xs font-medium text-muted-fg sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_2.25rem]"
      >
        <span>Email</span>
        <span>First name</span>
        <span>Last name</span>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.id}
          className="relative grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_2.25rem]"
        >
          <label className="block min-w-0">
            <span className={PHONE_LABEL}>Email</span>
            <EmailInput
              name="email"
              value={r.email}
              onChange={(e) => update(r.id, "email", e.target.value)}
              placeholder="mentor@example.com"
              aria-label={`Mentor ${i + 1} email`}
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
              aria-label={`Mentor ${i + 1} first name`}
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
              aria-label={`Mentor ${i + 1} last name`}
            />
          </label>
          <button
            type="button"
            onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
            aria-label={`Remove mentor ${i + 1}`}
            className="absolute -right-2 -top-2 flex h-11 w-11 items-center justify-center rounded-lg text-muted-fg transition-colors hover:bg-canvas hover:text-danger-ink sm:static sm:w-9"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="-ml-2 flex flex-wrap items-start gap-2">
        <Button type="button" variant="ghost" onClick={addRow}>
          Another mentor
        </Button>
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          <RosterImport noun="mentor" onImport={importPeople} />
        </div>
      </div>
      <ProgramTargetsPicker key={attempt} programs={programs} legend="Programs" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onOne} className="-ml-2">
          One at a time
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted-fg" aria-live="polite">
            {count > 0 ? (
              <>
                <span className="font-medium tabular-nums text-ink">{count}</span> ready to register
              </>
            ) : (
              blocking
            )}
          </p>
          <Button
            type="submit"
            variant={count > 0 ? "primary" : "secondary"}
            disabled={pending || count === 0}
          >
            {pending
              ? "Registering…"
              : count > 0
                ? `Register ${count} mentor${count === 1 ? "" : "s"}`
                : "Register mentors"}
          </Button>
        </div>
      </div>
      <SaveState state={save} />
    </form>
  );
}

/** A field's name above it on a phone; from `sm` the column headings say it. */
const PHONE_LABEL = "mb-1 block text-xs font-medium text-muted-fg sm:sr-only";

type RegisterErrors = Partial<Record<"email" | "firstName" | "lastName", string>>;

/**
 * A ring rather than a border or a fill: `cn` joins classes without merging
 * them, so a second `border-*` or `bg-*` would race the field's own by CSS
 * order. A ring is a property the field does not set.
 */
const invalidClass = "ring-1 ring-danger";

/** Email and both names, in the words each field shows under itself. */
function checkRegister(data: FormData): RegisterErrors {
  const errors: RegisterErrors = {};
  const text = (name: string) => String(data.get(name) ?? "").trim();
  const email = text("email");
  if (!email) errors.email = "Enter the address they sign in with.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "That doesn't look like an email address.";
  }
  if (!text("firstName")) errors.firstName = "Enter their first name.";
  if (!text("lastName")) errors.lastName = "Enter their last name.";
  return errors;
}

/**
 * Edit one mentor: their name, their sign-in email, and their pairings.
 *
 * `canEditIdentity` mirrors `updateMentor`'s own rule rather than inventing a
 * second one: a name and a sign-in email are platform-admin writes, because
 * whoever can point another admin's login at a mailbox they own can become
 * them. The two fields are still POSTED when they are read-only — the action
 * asks whether they MOVED, not whether they were submitted, so a locked field
 * that sends its current value is a save with no identity change in it.
 *
 * `programs` is the reader's own program list, which is what makes the unticked
 * boxes safe to read as removals: a pairing in a program they do not hold draws
 * no row here, and the action refuses to delete what drew no row.
 */
export function EditMentorForm({
  mentorId,
  name,
  email,
  targets,
  programs,
  canEditIdentity,
}: {
  mentorId: string;
  name: string;
  email: string;
  /** "p:<programId>" / "c:<cohortId>" for each pairing the reader can see. */
  targets: string[];
  programs: ProgramOption[];
  canEditIdentity: boolean;
}) {
  const { formProps, save } = useAutosave(updateMentor);

  return (
    <form
      {...formProps}
      className="rise-in mt-2 rounded-xl bg-surface shadow-sm p-4"
      // Remount when the pairings change, so the checkboxes show what was
      // actually saved rather than what was typed.
      key={targets.join("|")}
    >
      <input type="hidden" name="mentorId" value={mentorId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Full name"
          required
          hint={canEditIdentity ? undefined : "A platform admin changes this."}
        >
          <NameInput
            name="name"
            required
            defaultValue={name}
            readOnly={!canEditIdentity}
            className={canEditIdentity ? undefined : "text-muted-fg"}
          />
        </Field>
        <Field
          label="Email"
          required
          hint={canEditIdentity ? undefined : "A platform admin changes this."}
        >
          <EmailInput
            name="email"
            required
            defaultValue={email}
            readOnly={!canEditIdentity}
            className={canEditIdentity ? undefined : "text-muted-fg"}
          />
        </Field>
      </div>
      <ProgramTargetsPicker
        programs={programs}
        defaultTargets={targets}
        legend="Programs"
        // Unticking everything is a real choice: it parks the mentor as
        // unassigned, which is how a mentor who has left one program and not
        // yet joined another is recorded.
        required={false}
      />
      <SaveState state={save} />
    </form>
  );
}
