"use client";

import { useState } from "react";

import { setPlatformAdmin, setProgramAccess } from "@/lib/actions/grants";
import { Button } from "@/components/ui/button";
import { RowActionGroup, RowActionMenu } from "@/components/ui/row-action-menu";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * The only editor for program access in the app.
 *
 * One person, every program, one save. Per-program saves would let a
 * half-finished edit stand — and "which programs is this person on?" is one
 * question, which the reader should be able to answer and change in one place.
 *
 * The levels are the two old scoped roles plus Admin. Nothing but Admin is
 * granted in practice today; they are offered because the model can say them
 * and because a program that wants a read-only coordinator should not need a
 * migration to get one.
 */

const LEVELS = [
  { value: "ADMIN", label: "Admin", hint: "Manages students, mentors and time." },
  { value: "LEADER", label: "Leader", hint: "Reads the program and its feedback." },
  { value: "SALES", label: "Sales", hint: "Reads the program's students." },
] as const;

export type GrantRow = {
  userId: string;
  name: string | null;
  email: string;
  platformAdmin: boolean;
  /** programId → level, for the programs they hold. */
  grants: Record<string, string>;
};

export function GrantsEditor({
  row,
  programs,
}: {
  row: GrantRow;
  programs: { id: string; name: string }[];
}) {
  const [, action, save] = useSaveState(setProgramAccess);
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(programs.map((p) => [p.id, p.id in row.grants]))
  );

  return (
    <RowActionMenu trigger="pencil" label={`Change ${row.name ?? row.email}'s access`} verb="Edit" width="lg">
      <RowActionGroup label="Programs">
        <form action={action} className="space-y-2">
          <input type="hidden" name="userId" value={row.userId} />
          {programs.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2">
              <label className="flex min-h-11 flex-1 items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="program"
                  value={p.id}
                  checked={checked[p.id] ?? false}
                  onChange={(e) =>
                    setChecked((c) => ({ ...c, [p.id]: e.target.checked }))
                  }
                  className="h-4 w-4 shrink-0 accent-brand"
                />
                {p.name}
              </label>
              {/* The level only means anything for a program that is ticked,
                  and it is submitted either way — the action reads it per
                  program from the boxes that came back. */}
              <select
                name={`level:${p.id}`}
                defaultValue={row.grants[p.id] ?? "ADMIN"}
                disabled={!checked[p.id]}
                className="min-h-11 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink disabled:opacity-50"
              >
                {LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <p className="text-xs text-muted-fg">
            Unticking a program removes that access. Program admins manage that
            program&apos;s students, mentors and time.
          </p>
          <SubmitButton size="sm">Save access</SubmitButton>
          <SaveState state={save} />
        </form>
      </RowActionGroup>

      <RowActionGroup label="Platform">
        <PlatformToggle row={row} />
      </RowActionGroup>
    </RowActionMenu>
  );
}

/**
 * The flag that sees every program without a grant, and is the only thing that
 * may write these rows. Guarded server-side against emptying the set: a
 * platform with no platform admin has no way to make one.
 */
function PlatformToggle({ row }: { row: GrantRow }) {
  const [, action, save] = useSaveState(setPlatformAdmin);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="userId" value={row.userId} />
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="platformAdmin"
          defaultChecked={row.platformAdmin}
          className="h-4 w-4 shrink-0 accent-brand"
        />
        Runs the platform
      </label>
      <p className="text-xs text-muted-fg">
        Sees every program, present and future, and is the only person who can
        grant access.
      </p>
      <Button type="submit" variant="secondary" size="sm">
        Save
      </Button>
      <SaveState state={save} />
    </form>
  );
}
