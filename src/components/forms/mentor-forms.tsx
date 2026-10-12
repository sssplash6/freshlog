"use client";

import { useState } from "react";

import { ProgramTargetsPicker } from "@/components/forms/program-targets-picker";
import { EmailInput, Field, Input, NameInput } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { createMentor, updateMentor } from "@/lib/actions/mentors";
import { NAME_MAX } from "@/lib/actions/shared";
import type { ProgramOption } from "@/lib/queries";

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
 * docs/archive/REDESIGN.md §5.2 files both of these under `forms/people-forms.tsx`, together
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
    >
      {/* One row from `sm`: the address and the two names are three short
          fields. Two boxes for the name, not one: a box labelled "Full name"
          is a box people put one word in. `createMentor` joins them, the same
          as the students form. `items-start`, so an error under one field
          does not lift the others. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field label="Email" required error={errors.email} className="min-w-0 sm:flex-[3_1_0%]">
          <EmailInput
            name="email"
            required
            placeholder="mentor@example.com"
            aria-invalid={Boolean(errors.email) || undefined}
            className={errors.email ? invalidClass : undefined}
          />
        </Field>
        <Field label="First name" required error={errors.firstName} className="min-w-0 sm:flex-[2_1_0%]">
          <Input
            name="firstName"
            type="text"
            required
            autoComplete="off"
            maxLength={NAME_MAX}
            measure="sm"
            aria-invalid={Boolean(errors.firstName) || undefined}
            className={errors.firstName ? invalidClass : undefined}
          />
        </Field>
        <Field label="Last name" required error={errors.lastName} className="min-w-0 sm:flex-[2_1_0%]">
          <Input
            name="lastName"
            type="text"
            required
            autoComplete="off"
            maxLength={NAME_MAX}
            measure="sm"
            aria-invalid={Boolean(errors.lastName) || undefined}
            className={errors.lastName ? invalidClass : undefined}
          />
        </Field>
      </div>
      <ProgramTargetsPicker programs={programs} legend="Programs" />
      {/* The count above the button, each message under its own field (DESIGN §8). */}
      {errorCount > 0 && (
        <p role="alert" className="mt-3 text-xs font-medium text-danger-ink">
          {errorCount === 1 ? "Fix 1 field" : `Fix ${errorCount} fields`}
        </p>
      )}
      <div className="mt-3 flex justify-end">
        <SubmitButton pendingText="Registering…">Register mentor</SubmitButton>
      </div>
      {errorCount === 0 && <SaveState state={save} />}
    </form>
  );
}

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
  if (!email) errors.email = "Required";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Not an email address";
  }
  if (!text("firstName")) errors.firstName = "Required";
  if (!text("lastName")) errors.lastName = "Required";
  return errors;
}

/**
 * Edit one mentor: their name, their sign-in email, and their pairings.
 *
 * Saved with a button, the way Register is: one save model for the two forms
 * an admin opens from the same place. A button also keeps an unticked program
 * from removing a pairing on the click that unticked it.
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
  const [dirty, setDirty] = useState(false);
  const [state, action, save] = useSaveState(updateMentor, dirty);
  // Clean again once the edit is saved, adjusted during render.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setDirty(false);
  }

  return (
    <form
      action={action}
      onChange={() => setDirty(true)}
      // Remount when the pairings change, so the checkboxes show what was
      // actually saved rather than what was typed.
      key={targets.join("|")}
    >
      <input type="hidden" name="mentorId" value={mentorId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field label="Full name" required className="min-w-0 sm:flex-1">
          <NameInput
            name="name"
            required
            defaultValue={name}
            readOnly={!canEditIdentity}
            className={canEditIdentity ? undefined : "text-muted-fg"}
          />
        </Field>
        <Field label="Email" required className="min-w-0 sm:flex-1">
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
      <div className="mt-3 flex justify-end">
        <SubmitButton pendingText="Saving…" disabled={!dirty}>
          Save
        </SubmitButton>
      </div>
      <SaveState state={save} />
    </form>
  );
}
