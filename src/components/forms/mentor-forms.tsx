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
      <div className="mt-3 flex justify-end">
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
  const [, action, save] = useSaveState(updateMentor);

  return (
    <form
      action={action}
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
      <div className="mt-3 flex justify-end">
        <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
      </div>
      <SaveState state={save} />
    </form>
  );
}
