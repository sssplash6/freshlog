"use client";

import { useId, useMemo, useState } from "react";

import { Field, Input } from "@/components/ui/field";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { RowActionGroup, RowActionMenu } from "@/components/ui/row-action-menu";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SegmentedRadio } from "@/components/ui/segmented";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  addStudentUniversity,
  correctUniversityWords,
  removeStudentUniversity,
  saveApplicationSnapshot,
  setPrimaryUniversity,
} from "@/lib/actions/applications";
import { ROUNDS, universityKey, wordsLabel } from "@/lib/applications";
import { cn } from "@/lib/cn";

const ROUND_OPTIONS = [
  { value: "", label: "None" },
  ...ROUNDS.map((r) => ({ value: r, label: r })),
];

/** SAT, IELTS, school and GPA, edited together behind the section's pencil. */
export function SnapshotEditor({
  studentProfileId,
  current,
}: {
  studentProfileId: string;
  current: { sat: number | null; ielts: number | null; school: string | null; gpa: string | null };
}) {
  const [result, action, save] = useSaveState(saveApplicationSnapshot);
  const errorFor = (field: string) =>
    result && !result.ok && result.field === field ? result.error : undefined;

  return (
    <RowActionMenu trigger="pencil" label="Edit the application snapshot">
      <RowActionGroup label="Snapshot">
        <form action={action} className="space-y-3">
          <input type="hidden" name="studentProfileId" value={studentProfileId} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="SAT" error={errorFor("sat")}>
              <Input
                name="sat"
                inputMode="numeric"
                placeholder="1450"
                defaultValue={current.sat ?? ""}
              />
            </Field>
            <Field label="IELTS" error={errorFor("ielts")}>
              <Input
                name="ielts"
                inputMode="decimal"
                placeholder="7.5"
                defaultValue={current.ielts ?? ""}
              />
            </Field>
          </div>
          <Field label="School" error={errorFor("school")}>
            <Input name="school" defaultValue={current.school ?? ""} />
          </Field>
          <Field label="GPA" error={errorFor("gpa")}>
            <Input name="gpa" defaultValue={current.gpa ?? ""} />
          </Field>
          <SubmitButton size="sm" pendingText="Saving…">Save snapshot</SubmitButton>
          <SaveState state={save} />
        </form>
      </RowActionGroup>
    </RowActionMenu>
  );
}

export type UniversityChoice = { id: string; name: string; supplementalWords: number };

/**
 * Put a university on the student's list.
 *
 * Type to search the shared list; pick one and its word count comes with it.
 * A name nobody has added yet asks for the count — once, for everybody after.
 * A name that matches one already saved, however it is capitalised, IS that
 * one, so the same university is never entered twice with two counts.
 */
export function AddUniversityForm({
  studentProfileId,
  universities,
  onList,
  primaryName,
}: {
  studentProfileId: string;
  universities: UniversityChoice[];
  /** University ids already on this student's list, offered as taken. */
  onList: string[];
  /** The current primary; with none yet, the first one added is ticked as primary. */
  primaryName: string | null;
}) {
  const [result, action, save] = useSaveState(addStudentUniversity);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<UniversityChoice | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [primary, setPrimary] = useState(primaryName === null);
  // React resets an uncontrolled form after a successful action; these are
  // controlled, so they are reset by hand when a result lands.
  // The checkbox is remounted too: the form's own reset puts it back to the
  // `checked` it rendered with first, whatever `primary` now says.
  const [seen, setSeen] = useState(result);
  const [resets, setResets] = useState(0);
  if (seen !== result) {
    setSeen(result);
    if (result?.ok) {
      setQuery("");
      setPicked(null);
      setPrimary(false);
      setResets((n) => n + 1);
    }
  }

  const baseId = useId();
  const listId = `${baseId}-list`;
  const taken = useMemo(() => new Set(onList), [onList]);

  const exact = useMemo(() => {
    const key = universityKey(query);
    return key ? (universities.find((u) => universityKey(u.name) === key) ?? null) : null;
  }, [query, universities]);
  // A typed name that matches a saved one is a pick, whether or not the
  // reader clicked it in the list.
  const chosen = picked ?? exact;

  const matches = useMemo(() => {
    const words = universityKey(query).split(" ").filter(Boolean);
    if (words.length === 0) return [];
    return universities
      .filter((u) => {
        const name = u.name.toLowerCase();
        return words.every((w) => name.includes(w));
      })
      .slice(0, 8);
  }, [query, universities]);

  const choose = (u: UniversityChoice) => {
    if (taken.has(u.id)) return;
    setPicked(u);
    setQuery(u.name);
    setOpen(false);
  };

  const showList = open && matches.length > 0 && !(chosen && matches.length === 1);
  const isNew = query.trim().length > 1 && !chosen;

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="studentProfileId" value={studentProfileId} />
      <input type="hidden" name="universityId" value={chosen ? chosen.id : "new"} />
      <input type="hidden" name="newName" value={chosen ? "" : query} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-40 flex-1 basis-48 sm:max-w-xs">
          <Input
            role="combobox"
            aria-label="University"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList ? `${baseId}-opt-${active}` : undefined}
            autoComplete="off"
            placeholder="Search universities"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPicked(null);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(event) => {
              if (!showList) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((i) => Math.min(i + 1, matches.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const u = matches[active];
                if (u) choose(u);
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          {showList && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Universities"
              className="absolute inset-x-0 z-20 mt-1 max-h-64 overflow-auto rounded-xl bg-surface py-1 shadow-lg ring-1 ring-line"
            >
              {matches.map((u, i) => {
                const isTaken = taken.has(u.id);
                return (
                  <li
                    key={u.id}
                    id={`${baseId}-opt-${i}`}
                    role="option"
                    aria-selected={i === active}
                    aria-disabled={isTaken}
                    // mousedown, not click: the input's blur closes the list
                    // before a click would land.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      choose(u);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "flex cursor-pointer items-baseline justify-between gap-3 px-3.5 py-2 text-body",
                      i === active && "bg-fill",
                      isTaken && "cursor-default text-muted-fg"
                    )}
                  >
                    <span className="min-w-0 truncate">{u.name}</span>
                    <span className="shrink-0 text-xs text-muted-fg">
                      {isTaken ? "On their list" : wordsLabel(u.supplementalWords)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {isNew && (
          <div className="w-44">
            <Input
              name="words"
              aria-label="Supplemental word count"
              inputMode="numeric"
              placeholder="Supplemental words"
              required
            />
          </div>
        )}

        <label className="flex min-h-11 items-center gap-2 text-body text-ink">
          <input
            key={resets}
            type="checkbox"
            name="primary"
            checked={primary}
            onChange={(event) => setPrimary(event.target.checked)}
            className="h-4 w-4 accent-brand"
          />
          Primary
        </label>
        {primary && (
          <SegmentedRadio
            name="round"
            legend={<span className="sr-only">Round</span>}
            options={ROUND_OPTIONS}
            defaultValue=""
          />
        )}

        <SubmitButton
          size="sm"
          variant="secondary"
          pendingText="Adding…"
          className="min-h-11"
          disabled={query.trim().length < 2 || Boolean(chosen && taken.has(chosen.id))}
        >
          Add
        </SubmitButton>
      </div>
      <SaveState state={save} />
    </form>
  );
}

/**
 * The ⋮ on one university of the student's list: make it the primary (or
 * change the primary's round), correct its word count — admins only, and for
 * every student — and take it off the list.
 */
export function UniversityRowActions({
  studentProfileId,
  row,
  canCorrectWords,
}: {
  studentProfileId: string;
  row: {
    id: string;
    isPrimary: boolean;
    round: string | null;
    university: UniversityChoice;
  };
  canCorrectWords: boolean;
}) {
  const [, primaryAction, primarySave] = useSaveState(setPrimaryUniversity);
  const [wordsResult, wordsAction, wordsSave] = useSaveState(correctUniversityWords);
  const [, removeAction, removeSave] = useSaveState(removeStudentUniversity);
  const name = row.university.name;

  return (
    <RowActionMenu trigger="dots" label={`Change ${name}`}>
      <RowActionGroup label={row.isPrimary ? "Round" : "Primary choice"}>
        <form action={primaryAction} className="space-y-2">
          <input type="hidden" name="studentProfileId" value={studentProfileId} />
          <input type="hidden" name="id" value={row.id} />
          <SegmentedRadio
            name="round"
            legend={row.isPrimary ? "Round (optional)" : "Make it their primary choice, round (optional)"}
            options={ROUND_OPTIONS}
            defaultValue={row.round ?? ""}
          />
          <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
            {row.isPrimary ? "Save round" : "Make primary"}
          </SubmitButton>
          <SaveState state={primarySave} />
        </form>
      </RowActionGroup>
      {canCorrectWords && (
        <RowActionGroup label="Word count">
          <form action={wordsAction} className="space-y-2">
            <input type="hidden" name="universityId" value={row.university.id} />
            <Field
              label="Supplemental word count"
              error={wordsResult && !wordsResult.ok ? wordsResult.error : undefined}
            >
              <Input
                name="words"
                inputMode="numeric"
                defaultValue={row.university.supplementalWords}
                className="max-w-40"
              />
            </Field>
            <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
              Save word count
            </SubmitButton>
            {wordsSave.kind !== "failed" && <SaveState state={wordsSave} />}
          </form>
        </RowActionGroup>
      )}
      <RowActionGroup>
        <ConfirmInline
          variant="quiet"
          label="Remove from their list"
          question={`${name} and its supplemental's stage come off their list. The university stays in the shared list.`}
          confirmLabel="Yes, remove it"
          action={removeAction}
          values={{ studentProfileId, id: row.id }}
          pending={removeSave.kind === "saving"}
        />
        <SaveState state={removeSave} />
      </RowActionGroup>
    </RowActionMenu>
  );
}
