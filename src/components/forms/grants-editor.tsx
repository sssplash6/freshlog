"use client";

import { useState } from "react";

import {
  removeProgramGrant,
  setPlatformAdmin,
  setProgramAccess,
  setProgramGrant,
} from "@/lib/actions/grants";
import type { ActionState } from "@/lib/actions/shared";
import { Labelled } from "@/components/forms/labelled";
import { Select } from "@/components/select";
import { PersonChip } from "@/components/person-chip";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { RowActionGroup, RowActionMenu } from "@/components/ui/row-action-menu";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * The only editor for program access in the app.
 *
 * One person, every program, one save. Per-program saves would let a
 * half-finished edit stand — and "which programs is this person on?" is one
 * question, which the reader should be able to answer and change in one place.
 * The platform flag rides the same Save.
 *
 * The levels are named and nothing more: a hint that says what a level
 * "reads only" is a guarantee, and the level select once shipped one the
 * server did not keep (audit C3).
 */

/** One name per level, everywhere it is shown (DESIGN.md C7). */
const LEVELS = [
  { value: "ADMIN", label: "Admin" },
  { value: "LEADER", label: "Leader" },
  { value: "SALES", label: "Sales" },
];
const levelLabel = (role: string) => LEVELS.find((l) => l.value === role)?.label ?? role;

/** Most access first — the order of LEVELS, and the order `widest` in nav.ts ranks. */
const RANK: readonly string[] = LEVELS.map((l) => l.value);

/**
 * The level a newly ticked program starts on: the highest this person already
 * holds anywhere, or the lowest level if they hold none. Pre-selecting Admin
 * meant ticking a second program for a Sales grantee quietly offered them the
 * top level, one careless save away.
 */
function startingLevel(grants: Record<string, string>): string {
  const held = Object.values(grants).filter((g) => RANK.includes(g));
  if (held.length === 0) return RANK[RANK.length - 1];
  return held.reduce((best, g) => (RANK.indexOf(g) < RANK.indexOf(best) ? g : best));
}

export type GrantRow = {
  userId: string;
  name: string | null;
  email: string;
  platformAdmin: boolean;
  /** programId → level, for the programs they hold. */
  grants: Record<string, string>;
};

type ProgramGrant = {
  id: string;
  role: string;
  user: { id: string; name: string | null; email: string };
};

/**
 * Programs first, then the platform flag — two actions behind one Save. The
 * flag is written only when it changed, so saving programs never trips the
 * "somebody has to run the platform" guard.
 */
async function saveAccess(prev: ActionState, formData: FormData): Promise<ActionState> {
  const programs = await setProgramAccess(prev, formData);
  if (!programs?.ok) return programs;
  const was = formData.get("wasPlatformAdmin") === "1";
  const now = formData.get("platformAdmin") === "on";
  return was === now ? programs : setPlatformAdmin(prev, formData);
}

export function GrantsEditor({
  row,
  programs,
}: {
  row: GrantRow;
  programs: { id: string; name: string }[];
}) {
  const [, action, save] = useSaveState(saveAccess);
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(programs.map((p) => [p.id, p.id in row.grants]))
  );
  const fallback = startingLevel(row.grants);

  return (
    <RowActionMenu trigger="pencil" label={`Access for ${row.name ?? row.email}`} width="lg">
      <form action={action}>
        <RowActionGroup label="Programs">
          {programs.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2">
              <label className="flex min-h-11 flex-1 items-center gap-2 text-body text-ink">
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
              {/* The level only means anything for a ticked program, and the
                  action reads it only from the boxes that came back. */}
              {checked[p.id] && (
                <div className="w-32">
                  <Select
                    name={`level:${p.id}`}
                    ariaLabel={`Level in ${p.name}`}
                    options={LEVELS}
                    defaultValue={row.grants[p.id] ?? fallback}
                    measure="sm"
                  />
                </div>
              )}
            </div>
          ))}
        </RowActionGroup>

        <RowActionGroup label="Platform">
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="platformAdmin"
              defaultChecked={row.platformAdmin}
              className="h-4 w-4 shrink-0 accent-brand"
            />
            Platform admin
          </label>
        </RowActionGroup>

        {/* After the groups, so the first band is still `:first-child`. */}
        <input type="hidden" name="userId" value={row.userId} />
        <input type="hidden" name="wasPlatformAdmin" value={row.platformAdmin ? "1" : "0"} />
        <div className="mt-3">
          <SubmitButton size="sm">Save</SubmitButton>
          <SaveState state={save} />
        </div>
      </form>
    </RowActionMenu>
  );
}

/** Program-local access control, mounted from that program's Settings page. */
export function ProgramGrantsEditor({
  programId,
  grants,
  people,
  canEdit,
}: {
  programId: string;
  grants: ProgramGrant[];
  people: { id: string; name: string | null; email: string }[];
  canEdit: boolean;
}) {
  const granted = new Set(grants.map((grant) => grant.user.id));
  const available = people.filter((person) => !granted.has(person.id));

  return (
    <div className="px-4 py-2 sm:px-5">
      <ul className="divide-y divide-line/60 text-sm">
        {grants.map((grant) => (
          <ProgramGrantRow
            key={grant.id}
            programId={programId}
            grant={grant}
            canEdit={canEdit}
          />
        ))}
      </ul>
      {canEdit && available.length > 0 && (
        <ProgramGrantAddForm programId={programId} people={available} />
      )}
    </div>
  );
}

function ProgramGrantRow({
  programId,
  grant,
  canEdit,
}: {
  programId: string;
  grant: ProgramGrant;
  canEdit: boolean;
}) {
  const [, saveAction, save] = useSaveState(setProgramGrant);
  const [, removeAction, removeSave] = useSaveState(removeProgramGrant);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2">
      <PersonChip person={grant.user} size="sm" />
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <form action={saveAction} className="flex items-center gap-2">
            <input type="hidden" name="programId" value={programId} />
            <input type="hidden" name="userId" value={grant.user.id} />
            <div className="w-32">
              <Select
                name="role"
                ariaLabel="Level"
                options={LEVELS}
                defaultValue={grant.role}
                measure="sm"
              />
            </div>
            {/* Secondary: one per row, and a column of blue Saves is no primary. */}
            <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
          </form>
          <ConfirmInline
            variant="quiet"
            action={removeAction}
            values={{ programId, userId: grant.user.id }}
            pending={removeSave.kind === "saving"}
            label="Remove"
            question="Remove their access?"
            confirmLabel="Yes, remove"
            pendingLabel="Removing…"
          />
          <SaveState state={save} />
          <SaveState state={removeSave} />
        </div>
      ) : (
        <span className="text-xs text-muted-fg">
          {levelLabel(grant.role)}
        </span>
      )}
    </li>
  );
}

function ProgramGrantAddForm({
  programId,
  people,
}: {
  programId: string;
  people: { id: string; name: string | null; email: string }[];
}) {
  const [, action, save] = useSaveState(setProgramGrant);
  return (
    <div className="border-t border-line pt-2.5">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="programId" value={programId} />
        <Labelled label="Person" className="w-full sm:w-80">
          <Select
            name="userId"
            ariaLabel="Person"
            options={people.map((person) => ({
              value: person.id,
              label: person.name ?? person.email,
            }))}
          />
        </Labelled>
        <Labelled label="Level" className="w-full sm:w-48">
          <Select name="role" ariaLabel="Level" options={LEVELS} defaultValue="ADMIN" measure="sm" />
        </Labelled>
        <SubmitButton size="sm">Add access</SubmitButton>
        <SaveState state={save} />
      </form>
    </div>
  );
}
