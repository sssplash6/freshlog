"use client";

import { useId, useState } from "react";

import { Select, type SelectOption } from "@/components/select";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, Input } from "@/components/ui/field";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SettingsRow } from "@/components/ui/settings-row";
import { SubmitButton } from "@/components/ui/submit-button";
import { assignMentorToProgram, removeAssignment } from "@/lib/actions/mentors";
import {
  archiveProgram,
  createLevel,
  deleteCohort,
  deleteLevel,
  deleteProgram,
  renameProgram,
  setLevelStandardHours,
  setProgramHourBank,
  setProgramClassHours,
  setProgramTracksAdmissions,
  setProgramStandardHours,
  setProgramSpace,
  setProgramTracksPayment,
} from "@/lib/actions/programs";

/** Rename the program — one settings row, saved on its own. */
export function RenameProgramForm({
  programId,
  currentName,
}: {
  programId: string;
  currentName: string;
}) {
  const id = useId();
  const [name, setName] = useState(currentName);
  // No reset needed: the action revalidates, so a saved name arrives back as a
  // new `currentName` and the comparison goes false on its own.
  const [, action, save] = useSaveState(renameProgram, name !== currentName);

  return (
    <SettingsRow
      label="Program name"
      htmlFor={id}
      control={
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="programId" value={programId} />
          <Input
            id={id}
            name="name"
            type="text"
            required
            minLength={3}
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {/* Secondary: a settings page has no one action it exists for, and
              the masthead above already carries the program's primary. */}
          <SubmitButton variant="secondary" pendingText="Saving…">Save</SubmitButton>
        </form>
      }
      state={<SaveState state={save} />}
    />
  );
}

/**
 * Assign a mentor to this program — the same pairing the mentors page edits,
 * reached from the program's side. Program-wide unless something narrower is
 * named: a level, or a cohort inside it.
 *
 * A fold, like Add a cohort and Add a level beside it: one way to add a thing
 * to a program. Open by default only while the program has nobody to teach.
 */
export function AssignMentorForm({
  programId,
  mentors,
  levels,
  cohorts,
  defaultOpen = false,
}: {
  programId: string;
  mentors: SelectOption[];
  /** The program's levels, each carrying its cohorts for the cascade. */
  levels?: { id: string; name: string; cohorts: SelectOption[] }[];
  /** Its FLAT cohorts — empty whenever it has levels. */
  cohorts: SelectOption[];
  defaultOpen?: boolean;
}) {
  const [, action, save] = useSaveState(assignMentorToProgram);
  const [levelId, setLevelId] = useState("");
  const leveled = (levels?.length ?? 0) > 0;
  const level = levels?.find((l) => l.id === levelId) ?? null;
  const cohortOptions = leveled ? (level?.cohorts ?? []) : cohorts;

  return (
    <Disclosure label="Assign a mentor" variant="create" defaultOpen={defaultOpen}>
      <form action={action}>
        <input type="hidden" name="programId" value={programId} />
        {/* Mentor, then level and cohort where the program has them, and the
            button at the row's end; each field as wide as its measure. */}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Mentor" className="w-full sm:w-80">
            <Select name="mentorId" ariaLabel="Mentor" options={mentors} />
          </Field>
          {leveled && (
            <Field label="Level" className="w-full sm:w-48">
              <Select
                name="levelId"
                ariaLabel="Level"
                measure="sm"
                options={levels!.map((l) => ({ value: l.id, label: l.name }))}
                placeholder="Program-wide"
                required={false}
                onChange={(value) => setLevelId(value)}
              />
            </Field>
          )}
          {cohortOptions.length > 0 && (
            <Field label="Cohort" className="w-full sm:w-48">
              {/* `key` remounts when the level changes, so a cohort picked
                  under one level is never submitted under another. */}
              <Select
                key={levelId}
                name="cohortId"
                ariaLabel="Cohort"
                measure="sm"
                options={cohortOptions}
                placeholder={leveled ? "Whole level" : "Program-wide"}
                required={false}
              />
            </Field>
          )}
          <SubmitButton variant="secondary" pendingText="Assigning…">
            Assign
          </SubmitButton>
        </div>
        <SaveState state={save} />
      </form>
    </Disclosure>
  );
}

/**
 * Remove a mentor from this program — the pairing `AssignMentorForm` makes,
 * unmade. Only the pairing goes: time already allocated to students belongs to
 * the student and the mentor, not to the program row, so it stays.
 *
 * This was `forms/remove-assignment-button.tsx`, a file for one button, with
 * its own `useActionState` and its own hand-written `<span role="alert">` for
 * the error. `SaveState` says that better and says the other four states too,
 * and the button itself is now the same one the three below use.
 */
export function RemoveMentorButton({
  assignmentId,
}: {
  /** The MentorAssignment row — the pairing, not the mentor. */
  assignmentId: string;
}) {
  const [, action, save] = useSaveState(removeAssignment);

  return (
    <div className="flex flex-col items-end gap-1">
      {/* Quiet: a red word per row, not a column of outlined red boxes down
          a list of the program's own people. */}
      <ConfirmInline
        variant="quiet"
        action={action}
        values={{ assignmentId }}
        pending={save.kind === "saving"}
        label="Remove"
        question="Remove from this program?"
        confirmLabel="Yes, remove"
        pendingLabel="Removing…"
      />
      <SaveState state={save} />
    </div>
  );
}

/** Add a level to the program — "Emerging" inside Research. */
export function CreateLevelForm({ programId }: { programId: string }) {
  const [, action, save] = useSaveState(createLevel);

  return (
    <Disclosure label="Add a level" variant="create">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="programId" value={programId} />
        <Field label="Level name" required className="w-full sm:w-80">
          <Input name="name" type="text" required placeholder="e.g. Emerging" />
        </Field>
        <SubmitButton pendingText="Adding…">Add level</SubmitButton>
      </form>
      <SaveState state={save} />
    </Disclosure>
  );
}

/** Delete an empty level — the same ask an empty cohort gets, one row up. */
export function DeleteLevelButton({
  levelId,
  levelName,
}: {
  levelId: string;
  levelName: string;
}) {
  const [, action, save] = useSaveState(deleteLevel);

  return (
    <div className="flex flex-col items-end gap-1">
      <ConfirmInline
        variant="quiet"
        action={action}
        values={{ levelId }}
        pending={save.kind === "saving"}
        label={`Delete ${levelName}`}
        question="Delete this level?"
        confirmLabel="Yes, delete"
        pendingLabel="Deleting…"
      />
      <SaveState state={save} />
    </div>
  );
}

/** Delete an empty cohort. */
export function DeleteCohortButton({
  cohortId,
  cohortName,
}: {
  cohortId: string;
  cohortName: string;
}) {
  const [, action, save] = useSaveState(deleteCohort);

  return (
    <div className="flex flex-col items-end gap-1">
      <ConfirmInline
        variant="quiet"
        action={action}
        values={{ cohortId }}
        pending={save.kind === "saving"}
        // Named, because the row it sits in is one of several and a bare
        // "Delete" announces nothing about which.
        label={`Delete ${cohortName}`}
        question="Delete this cohort?"
        confirmLabel="Yes, delete"
        pendingLabel="Deleting…"
      />
      <SaveState state={save} />
    </div>
  );
}

/**
 * Does allocating time here also ask what the student paid?
 *
 * A button that names the change rather than a switch that needs a legend
 * beside it: the row already says what the setting is, so the control only has
 * to say which way it is about to move. One 44px target, one write. The label
 * is the whole statement of state — no pill and no sentence beside it (October
 * 2026: the state was said three times per row).
 */
export function TrackPaymentToggle({
  programId,
  tracksPayment,
}: {
  programId: string;
  tracksPayment: boolean;
}) {
  const [, action, save] = useSaveState(setProgramTracksPayment);

  return (
    <SettingsRow
      label="Amount paid"
      control={
        <form action={action}>
          <input type="hidden" name="programId" value={programId} />
          <input
            type="hidden"
            name="tracksPayment"
            value={tracksPayment ? "off" : "on"}
          />
          <SubmitButton variant="secondary" pendingText="Saving…">
            {tracksPayment ? "Stop asking" : "Ask for amounts"}
          </SubmitButton>
        </form>
      }
      state={<SaveState state={save} />}
    />
  );
}

/**
 * Present this program as an institute to the people who work only in it.
 * Platform admins only — the page renders it for no one else, and the action
 * refuses everyone else.
 */
export function InstituteSpaceForm({
  programId,
  programName,
  institute,
  spaceName,
}: {
  programId: string;
  programName: string;
  institute: boolean;
  spaceName: string | null;
}) {
  const id = useId();
  const [name, setName] = useState(spaceName ?? "");
  const [, action, save] = useSaveState(setProgramSpace);

  return (
    <SettingsRow
      label="Institute"
      htmlFor={id}
      control={
        <div className="flex flex-wrap items-end gap-3">
          {/* `contents`: the name, its button and "Show as program" share one
              row, though they are two forms. */}
          <form action={action} className="contents">
            <input type="hidden" name="programId" value={programId} />
            <input type="hidden" name="space" value="INSTITUTE" />
            <Input
              id={id}
              name="spaceName"
              type="text"
              maxLength={80}
              placeholder={programName}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <SubmitButton variant="secondary" pendingText="Saving…">
              {institute ? "Save" : "Show as institute"}
            </SubmitButton>
          </form>
          {/* No name field: turning it off keeps the name for next time. */}
          {institute && (
            <form action={action}>
              <input type="hidden" name="programId" value={programId} />
              <input type="hidden" name="space" value="PROGRAM" />
              <SubmitButton variant="secondary" pendingText="Saving…">
                Show as program
              </SubmitButton>
            </form>
          )}
        </div>
      }
      state={<SaveState state={save} />}
    />
  );
}

/** Does each student here hold one hour bank that every meeting draws? */
export function HourBankToggle({
  programId,
  hourBank,
}: {
  programId: string;
  hourBank: boolean;
}) {
  const [, action, save] = useSaveState(setProgramHourBank);

  return (
    <SettingsRow
      label="Hour banks"
      control={
        <form action={action}>
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="hourBank" value={hourBank ? "off" : "on"} />
          <SubmitButton variant="secondary" pendingText="Saving…">
            {hourBank ? "Stop offering banks" : "Offer hour banks"}
          </SubmitButton>
        </form>
      }
      state={<SaveState state={save} />}
    />
  );
}

/** Does this program log its hours as classes, for groups rather than students? */
export function ClassHoursToggle({
  programId,
  classHours,
}: {
  programId: string;
  classHours: boolean;
}) {
  const [, action, save] = useSaveState(setProgramClassHours);

  return (
    <SettingsRow
      label="Class hours"
      control={
        <form action={action}>
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="classHours" value={classHours ? "off" : "on"} />
          <SubmitButton variant="secondary" pendingText="Saving…">
            {classHours ? "Log per student" : "Log as classes"}
          </SubmitButton>
        </form>
      }
      state={<SaveState state={save} />}
    />
  );
}

/** Does this program follow its students' university applications? */
export function TracksAdmissionsToggle({
  programId,
  tracksAdmissions,
}: {
  programId: string;
  tracksAdmissions: boolean;
}) {
  const [, action, save] = useSaveState(setProgramTracksAdmissions);

  return (
    <SettingsRow
      label="University applications"
      control={
        <form action={action}>
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="tracksAdmissions" value={tracksAdmissions ? "off" : "on"} />
          <SubmitButton variant="secondary" pendingText="Saving…">
            {tracksAdmissions ? "Stop tracking applications" : "Track applications"}
          </SubmitButton>
        </form>
      }
      state={<SaveState state={save} />}
    />
  );
}

/**
 * The two boxes a standard grant is: minutes, and the days to use them in.
 * Shared by the program's row and each level's.
 */
function GrantBoxes({
  minutesId,
  minutes,
  days,
  setMinutes,
  setDays,
  placeholders,
}: {
  minutesId: string;
  minutes: string;
  days: string;
  setMinutes: (value: string) => void;
  setDays: (value: string) => void;
  /** What an empty box means — "Off", or the grant a level inherits. */
  placeholders: { minutes: string; days: string };
}) {
  return (
    <>
      <Field label="Minutes">
        <Input
          id={minutesId}
          name="minutes"
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          measure="xs"
          placeholder={placeholders.minutes}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
        />
      </Field>
      <Field label="Use within (days)">
        <Input
          name="days"
          type="number"
          inputMode="numeric"
          min="1"
          max="1095"
          step="1"
          measure="xs"
          placeholder={placeholders.days}
          value={days}
          onChange={(event) => setDays(event.target.value)}
        />
      </Field>
    </>
  );
}

/**
 * The grant every student who joins this program receives: minutes into their
 * hour bank or unassigned pool, to use within a number of days of joining. Both
 * boxes empty is off, and the empty boxes say so. A change reaches only the
 * students who join after it.
 */
export function StandardHoursForm({
  programId,
  standardMinutes,
  standardDays,
}: {
  programId: string;
  standardMinutes: number | null;
  standardDays: number | null;
}) {
  const minutesId = useId();
  const [minutes, setMinutes] = useState(standardMinutes?.toString() ?? "");
  const [days, setDays] = useState(standardDays?.toString() ?? "");
  const dirty =
    minutes.trim() !== (standardMinutes?.toString() ?? "") ||
    days.trim() !== (standardDays?.toString() ?? "");
  const [, action, save] = useSaveState(setProgramStandardHours, dirty);

  return (
    <SettingsRow
      label="Standard hours"
      htmlFor={minutesId}
      control={
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="programId" value={programId} />
          <GrantBoxes
            minutesId={minutesId}
            minutes={minutes}
            days={days}
            setMinutes={setMinutes}
            setDays={setDays}
            placeholders={{ minutes: "Off", days: "Off" }}
          />
          <SubmitButton variant="secondary" pendingText="Saving…">Save</SubmitButton>
        </form>
      }
      state={<SaveState state={save} />}
    />
  );
}

/**
 * The grant every student joining at THIS level receives — the pair the
 * program's own `StandardHoursForm` holds, one row down, where Emerging's two
 * hours and Advanced's fifteen actually differ. Both boxes empty means the
 * level inherits the program's, which the empty boxes show.
 */
export function LevelStandardHoursForm({
  levelId,
  standardMinutes,
  standardDays,
  inherited,
}: {
  levelId: string;
  standardMinutes: number | null;
  standardDays: number | null;
  /** The program's own grant, shown in the empty boxes. */
  inherited: { minutes: number | null; days: number | null };
}) {
  const minutesId = useId();
  const [minutes, setMinutes] = useState(standardMinutes?.toString() ?? "");
  const [days, setDays] = useState(standardDays?.toString() ?? "");
  const dirty =
    minutes.trim() !== (standardMinutes?.toString() ?? "") ||
    days.trim() !== (standardDays?.toString() ?? "");
  const [, action, save] = useSaveState(setLevelStandardHours, dirty);

  return (
    <SettingsRow
      label="Standard hours"
      htmlFor={minutesId}
      control={
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="levelId" value={levelId} />
          <GrantBoxes
            minutesId={minutesId}
            minutes={minutes}
            days={days}
            setMinutes={setMinutes}
            setDays={setDays}
            placeholders={{
              minutes: inherited.minutes?.toString() ?? "Off",
              days: inherited.days?.toString() ?? "Off",
            }}
          />
          <SubmitButton variant="secondary" pendingText="Saving…">Save</SubmitButton>
        </form>
      }
      state={<SaveState state={save} />}
    />
  );
}

/**
 * Archive the program, or put it back.
 *
 * The non-destructive end of the same life-cycle `DeleteProgramButton` sits at,
 * which is why they share a page and a shape. Archiving is what a program that
 * RAN does: deletion is refused while it holds a single student, and a finished
 * cohort's ledger is exactly what nobody wants deleted.
 */
export function ArchiveProgramButton({
  programId,
  programName,
  archived,
}: {
  programId: string;
  programName: string;
  archived: boolean;
}) {
  const [, action, save] = useSaveState(archiveProgram);

  return (
    <div>
      {/* Not red: archiving loses nothing, and every ledger page stays
          reachable. A grey first step, a blue confirm. */}
      <ConfirmInline
        tone="primary"
        action={action}
        values={{ programId, restore: archived ? "true" : "false" }}
        pending={save.kind === "saving"}
        label={archived ? "Reopen program" : "Archive program"}
        question={archived ? `Reopen ${programName}?` : `Archive ${programName}?`}
        confirmLabel={archived ? "Yes, reopen it" : "Yes, archive it"}
        pendingLabel={archived ? "Reopening…" : "Archiving…"}
      />
      <SaveState state={save} />
    </div>
  );
}

/** Close the program down, once nothing is left in it. */
export function DeleteProgramButton({
  programId,
  programName,
  blockedReason,
}: {
  programId: string;
  programName: string;
  /** Why it can't go yet, shown beside the disabled button. */
  blockedReason?: string;
}) {
  const [, action, save] = useSaveState(deleteProgram);

  return (
    <div>
      {/* The page-level destructive button — grey fill, red words, full
          height — beside Archive's grey fill and blue words, so the two ends
          of a program's life read as a pair. It was the menu-panel red word,
          which at 12px beside a sentence of grey looked disabled even when it
          was not. */}
      <ConfirmInline
        action={action}
        values={{ programId }}
        pending={save.kind === "saving"}
        label="Delete program"
        question={`Delete ${programName} for good?`}
        confirmLabel="Yes, delete it"
        pendingLabel="Deleting…"
        disabledReason={blockedReason}
      />
      <SaveState state={save} />
    </div>
  );
}
