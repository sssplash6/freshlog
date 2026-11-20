"use client";

import {
  archiveMentor,
  archiveStudent,
  restoreMentor,
  restoreStudent,
} from "@/lib/actions/archive";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Archive and Restore, for a student's page and a mentor's.
 *
 * Archive asks first, and what it asks is the consequence: the person loses
 * their sign-in and leaves every list. It is not red — nothing is destroyed,
 * and Restore beside the same name undoes it — which is the difference from
 * "Remove student" on the line below it.
 */

type Who =
  | { kind: "student"; studentProfileId: string }
  | { kind: "mentor"; mentorId: string };

const idOf = (who: Who): Record<string, string> =>
  who.kind === "student"
    ? { studentProfileId: who.studentProfileId }
    : { mentorId: who.mentorId };

export function ArchiveButton({ who, name }: { who: Who; name: string }) {
  const [, action, save] = useSaveState(
    who.kind === "student" ? archiveStudent : archiveMentor
  );
  return (
    <div className="space-y-2">
      <ConfirmInline
        variant="quiet"
        tone="primary"
        label={who.kind === "student" ? "Archive student" : "Archive mentor"}
        question={
          who.kind === "student"
            ? `${name} leaves every list and can no longer sign in. Their hours, sessions and tasks are all kept, and you can restore them.`
            : `${name} leaves every list and picker and can no longer sign in. Their sessions and the hours students hold with them are kept, and you can restore them.`
        }
        confirmLabel="Yes, archive them"
        action={action}
        values={idOf(who)}
        pending={save.kind === "saving"}
      />
      <SaveState state={save} />
    </div>
  );
}

export function RestoreButton({ who }: { who: Who }) {
  const [, action, save] = useSaveState(
    who.kind === "student" ? restoreStudent : restoreMentor
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      {Object.entries(idOf(who)).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton size="sm" variant="secondary">
        Restore
      </SubmitButton>
      <SaveState state={save} />
    </form>
  );
}
