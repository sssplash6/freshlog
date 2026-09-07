"use client";

import { ProgramTargetsPicker } from "@/components/forms/program-targets-picker";
import { Field, Input } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { createMentor, updateMentor } from "@/lib/actions/mentors";
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
 * Register a mentor: an email, a name, and the programs they work in.
 *
 * The mentor signs in with Google against that email afterwards and sets their
 * own booking links; nothing here can set one, because a link is per pairing
 * and belongs to the person whose calendar it opens.
 */
export function RegisterMentorForm({ programs }: { programs: ProgramOption[] }) {
  const [, action, save] = useSaveState(createMentor);

  return (
    <form action={action} className="rounded-xl border border-line bg-surface shadow-sm p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Email"
          required
          hint="The mentor signs in with this address."
        >
          <Input
            name="email"
            type="email"
            required
            placeholder="mentor@example.com"
          />
        </Field>
        <Field label="Full name" required>
          <Input name="name" type="text" required />
        </Field>
      </div>
      <ProgramTargetsPicker programs={programs} legend="Programs" />
      <div className="mt-3 flex justify-end">
        <SubmitButton pendingText="Registering…">Register mentor</SubmitButton>
      </div>
      <SaveState state={save} />
    </form>
  );
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
      className="rise-in mt-2 rounded-xl border border-line bg-surface shadow-sm p-4"
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
          <Input
            name="name"
            type="text"
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
          <Input
            name="email"
            type="email"
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
