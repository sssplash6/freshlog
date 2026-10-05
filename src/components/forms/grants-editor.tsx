"use client";

import { useState } from "react";

import { setPlatformAdmin, setProgramAccess } from "@/lib/actions/grants";
import { removeProgramGrant, setProgramGrant } from "@/lib/actions/grants";
import { Button } from "@/components/ui/button";
import { fieldChrome } from "@/components/ui/field";
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
 *
 * The levels are the two old scoped roles plus Admin. The copy describes each
 * by the pages it puts in the person's menu, and deliberately promises nothing
 * about what they cannot change: a hint that says "reads only" is a guarantee,
 * and the level select once shipped one the server did not keep (audit C3).
 * Say what the menu shows; give a level only to somebody trusted with the
 * program.
 */

const LEVELS = [
  {
    value: "ADMIN",
    label: "Admin",
    hint: "Manages this program's students, mentors, sessions and time.",
  },
  { value: "LEADER", label: "Leader", hint: "Menu shows Students, Feedback and the program." },
  { value: "SALES", label: "Sales", hint: "Menu shows Students and the program." },
] as const;

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
  const fallback = startingLevel(row.grants);

  return (
    <RowActionMenu trigger="pencil" label={`Change ${row.name ?? row.email}'s access`} width="lg">
      <RowActionGroup label="Program-specific access">
        <form action={action} className="space-y-2">
          <input type="hidden" name="userId" value={row.userId} />
          <p className="mb-2 text-xs text-muted-fg">
            Tick the programs this person works in, and pick the level for
            each. None of this gives platform-wide access.
          </p>
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
              {/* The level only means anything for a program that is ticked,
                  and it is submitted either way — the action reads it per
                  program from the boxes that came back. */}
              <select
                name={`level:${p.id}`}
                defaultValue={row.grants[p.id] ?? fallback}
                disabled={!checked[p.id]}
                // The app's field chrome — a grey fill — rather than the one
                // bordered white box left in the panel.
                className={`${fieldChrome} min-h-11 px-2.5 text-base disabled:opacity-50 sm:text-body`}
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
            Unticking a program removes that access.
          </p>
          <dl className="space-y-1 text-xs text-muted-fg">
            {LEVELS.map((l) => (
              <div key={l.value} className="flex gap-1">
                <dt className="font-medium text-ink">{l.label}:</dt>
                <dd>{l.hint}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-fg">
            Leader and Sales decide which pages a person is shown. Give any
            level only to somebody you trust with the program.
          </p>
          <SubmitButton size="sm">Save access</SubmitButton>
          <SaveState state={save} />
        </form>
      </RowActionGroup>

      <RowActionGroup label="Platform-wide access">
        <PlatformToggle row={row} />
      </RowActionGroup>
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
            <select
              name="role"
              defaultValue={grant.role}
              className="min-h-9 rounded-lg border border-line bg-surface px-2.5 text-xs text-ink"
            >
              <option value="ADMIN">Super admin</option>
              <option value="LEADER">Leader</option>
              <option value="SALES">Sales</option>
            </select>
            <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
          </form>
          <ConfirmInline
            variant="quiet"
            action={removeAction}
            values={{ programId, userId: grant.user.id }}
            pending={removeSave.kind === "saving"}
            label="Remove"
            question="Remove this person's access to the program?"
            confirmLabel="Yes, remove"
            pendingLabel="Removing…"
          />
          <SaveState state={save} />
          <SaveState state={removeSave} />
        </div>
      ) : (
        <span className="text-xs text-muted-fg">
          {grant.role === "ADMIN" ? "Super admin" : grant.role}
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
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="programId" value={programId} />
        <select
          name="userId"
          required
          defaultValue=""
          className="min-h-11 min-w-56 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink"
        >
          <option value="" disabled>Add a person…</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name ?? person.email}
            </option>
          ))}
        </select>
        <select
          name="role"
          defaultValue="ADMIN"
          className="min-h-11 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink"
        >
          <option value="ADMIN">Super admin</option>
          <option value="LEADER">Leader</option>
          <option value="SALES">Sales</option>
        </select>
        <SubmitButton size="sm">Add access</SubmitButton>
        <SaveState state={save} />
      </form>
    </div>
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
          Runs the platform (all programs)
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
