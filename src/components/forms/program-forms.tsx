"use client";

import { Disclosure } from "@/components/ui/disclosure";
import { Input } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { createCohort, createProgram } from "@/lib/actions/programs";

/**
 * The two "open something new" folds.
 *
 * Both were hand-rolled `useState` toggles in this one file, and in two
 * different shapes: a secondary `Button` that swapped itself for a form, and a
 * bare "+ Add a cohort to this program" text link that did the same thing
 * without a chevron, a focus ring or a name a screen reader could announce.
 * `ui/disclosure.tsx` exists because of these two — see the list in its header
 * — and it brings the thing neither had: a closed `<details>` still expands
 * when a browser finds text inside it.
 */

/** Open a new program. Platform admins only, gated in the action (§8.3). */
export function CreateProgramForm() {
  const [, action, save] = useSaveState(createProgram);

  return (
    <Disclosure
      label="New program"
      hint="It starts flat and empty; grant its admins access afterwards."
    >
      <form action={action} className="flex flex-wrap items-center gap-2">
        <div className="w-56">
          <Input
            name="name"
            type="text"
            required
            minLength={3}
            maxLength={80}
            placeholder="Program name"
          />
        </div>
        <SubmitButton pendingText="Creating…">Create program</SubmitButton>
      </form>
      <SaveState state={save} />
    </Disclosure>
  );
}

/**
 * Add a cohort to a program.
 *
 * Folded because programs are FLAT by default and most stay that way: the first
 * cohort changes how new enrollments work, which is a decision, not a field.
 * In a leveled program the cohort sits under a level, and the form is rendered
 * once per level with `levelId` already set rather than asking which.
 */
export function CreateCohortForm({
  programId,
  levelId,
  levelName,
}: {
  programId: string;
  levelId?: string;
  levelName?: string;
}) {
  const [, action, save] = useSaveState(createCohort);

  return (
    <Disclosure
      label="Add a cohort"
      hint={
        levelName
          ? `It joins ${levelName}, and students enrolling at that level pick it.`
          : "The first one switches NEW enrollments to cohorts; people already here stay put."
      }
    >
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="programId" value={programId} />
        {levelId && <input type="hidden" name="levelId" value={levelId} />}
        <div className="w-56">
          <Input name="name" type="text" required placeholder="e.g. Fall 2026" />
        </div>
        <SubmitButton pendingText="Adding…">Add cohort</SubmitButton>
      </form>
      <SaveState state={save} />
    </Disclosure>
  );
}
