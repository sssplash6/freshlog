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
import { formatDuration } from "@/lib/format";

const labelClass =
  "block text-xs text-muted-fg";

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
            className="min-w-56 flex-1"
          />
          {/* Secondary: a settings page has no one action it exists for, and
              the masthead above already carries the program's primary. */}
          <SubmitButton variant="secondary" pendingText="Saving…">Save name</SubmitButton>
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
 */
export function AssignMentorForm({
  programId,
  mentors,
  levels,
  cohorts,
}: {
  programId: string;
  mentors: SelectOption[];
  /** The program's levels, each carrying its cohorts for the cascade. */
  levels?: { id: string; name: string; cohorts: SelectOption[] }[];
  /** Its FLAT cohorts — empty whenever it has levels. */
  cohorts: SelectOption[];
}) {
  const [, action, save] = useSaveState(assignMentorToProgram);
  const [levelId, setLevelId] = useState("");
  const leveled = (levels?.length ?? 0) > 0;
  const level = levels?.find((l) => l.id === levelId) ?? null;
  const cohortOptions = leveled ? (level?.cohorts ?? []) : cohorts;

  return (
    <form action={action}>
      <input type="hidden" name="programId" value={programId} />
      {/* The heading takes its own line and the controls one row under it:
          select, then the button at its end. They shared one wrapping line,
          and in the program's narrow side card the 224px select pushed
          "Assign" down onto a row of its own, a button floating under a field
          it belongs beside (October 2026). The selects grow and the button
          keeps its size; under `sm` they stack, full width. */}
      <h3 className="text-body font-medium text-ink">Assign a mentor</h3>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 sm:min-w-48 sm:flex-1">
          {(leveled || cohortOptions.length > 0) && (
            <span className={labelClass}>Mentor</span>
          )}
          <div className={leveled || cohortOptions.length > 0 ? "mt-1" : undefined}>
            <Select
              name="mentorId"
              ariaLabel="Mentor"
              options={mentors}
              placeholder="Choose a mentor"
            />
          </div>
        </div>
        {leveled && (
          <div className="min-w-0 sm:min-w-40 sm:flex-1">
            <span className={labelClass}>Level</span>
            <div className="mt-1">
              <Select
                name="levelId"
                ariaLabel="Level"
                options={levels!.map((l) => ({ value: l.id, label: l.name }))}
                placeholder="Program-wide"
                required={false}
                onChange={(value) => setLevelId(value)}
              />
            </div>
          </div>
        )}
        {cohortOptions.length > 0 && (
          <div className="min-w-0 sm:min-w-40 sm:flex-1">
            <span className={labelClass}>Cohort</span>
            <div className="mt-1">
              {/* `key` remounts when the level changes, so a cohort picked
                  under one level is never submitted under another. */}
              <Select
                key={levelId}
                name="cohortId"
                ariaLabel="Cohort"
                options={cohortOptions}
                placeholder={leveled ? "Whole level" : "Program-wide"}
                required={false}
              />
            </div>
          </div>
        )}
        <SubmitButton variant="secondary" pendingText="Assigning…" className="shrink-0 max-sm:w-full">
          Assign
        </SubmitButton>
      </div>
      <SaveState state={save} />
    </form>
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
        question="They leave this program. Hours already allocated to students stay."
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
    <Disclosure
      label="Add a level" variant="create"
      hint="The first one makes this a leveled program: new enrollments pick a level, and its cohorts sit under one."
    >
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="programId" value={programId} />
        <Field label="Level name" required className="w-56">
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
        question="Nothing is in it, so nothing moves."
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
        question="Nobody is in it, so nothing moves."
        confirmLabel="Yes, delete"
        pendingLabel="Deleting…"
      />
      <SaveState state={save} />
    </div>
  );
}

/**
 * Whether a setting is on, as a word beside the button that flips it. The
 * button names the change ("Ask for amounts"), and which way it is going says
 * nothing about where it is now — that was a sentence in the description,
 * three lines up. Both are kept; this is the one the eye finds first (October
 * 2026 audit). Text, not colour alone.
 */
function OnOff({ on }: { on: boolean }) {
  return (
    <span
      className={
        on
          ? "inline-flex h-6 items-center rounded-full bg-brand-soft px-2.5 text-xs font-semibold text-brand"
          : "inline-flex h-6 items-center rounded-full bg-fill px-2.5 text-xs font-medium text-muted-fg"
      }
    >
      {on ? "On" : "Off"}
    </span>
  );
}

/**
 * Does allocating time here also ask what the student paid?
 *
 * A button that names the change rather than a switch that needs a legend
 * beside it: the row already says what the setting is, so the control only has
 * to say which way it is about to move. One 44px target, one write, and the
 * state it is in now is a sentence rather than a position.
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
      label="Track amount paid per allocation"
      description={
        tracksPayment
          ? "Allocating time asks for the amount, and the program's total carries it."
          : undefined
      }
      control={
        <form action={action} className="flex flex-wrap items-center gap-3">
          <OnOff on={tracksPayment} />
          <input type="hidden" name="programId" value={programId} />
          <input
            type="hidden"
            name="tracksPayment"
            value={tracksPayment ? "off" : "on"}
          />
          <SubmitButton variant="secondary" pendingText="Saving…">
            {tracksPayment ? "Stop asking for amounts" : "Ask for amounts"}
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
      label="Its own institute"
      htmlFor={id}
      description={
        institute
          ? "The people who work only here see it as its own place, with its levels in the sidebar."
          : "Show it as its own place to the people who work only here. Access does not change."
      }
      control={
        <div className="flex flex-wrap items-end gap-3">
          <form action={action} className="flex min-w-56 flex-1 flex-wrap items-end gap-3">
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
              className="min-w-56 flex-1"
            />
            <SubmitButton variant="secondary" pendingText="Saving…">
              {institute ? "Save name" : "Show as an institute"}
            </SubmitButton>
          </form>
          {/* No name field: turning it off keeps the name for next time. */}
          {institute && (
            <form action={action}>
              <input type="hidden" name="programId" value={programId} />
              <input type="hidden" name="space" value="PROGRAM" />
              <SubmitButton variant="secondary" pendingText="Saving…">
                Show as a program
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
      description={
        hourBank
          ? "Each student's hours are one bank that every mentor draws from."
          : "Hours are held per mentor. Turn this on to hold each student's hours as one bank."
      }
      control={
        <form action={action} className="flex flex-wrap items-center gap-3">
          <OnOff on={hourBank} />
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
      label="Logs hours as classes"
      description={
        classHours
          ? "The roster is groups, added by name. Logging an hour is logging it for a group's class."
          : "The roster is students, and an hour is logged for a student."
      }
      control={
        <form action={action}>
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="classHours" value={classHours ? "off" : "on"} />
          <SubmitButton variant="secondary" pendingText="Saving…">
            {classHours ? "Log hours per student" : "Log hours as classes"}
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
      description={
        tracksAdmissions
          ? "Each student's page shows their scores, essays and university list, for their mentors and this program's admins."
          : "Turn this on to follow each student's scores, essays and university list on their page."
      }
      control={
        <form action={action} className="flex flex-wrap items-center gap-3">
          <OnOff on={tracksAdmissions} />
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
 * The grant every student who joins this program receives: minutes into their
 * unassigned pool, to use within a number of days of joining. Both boxes
 * empty is off. The description says what is in force now, and that a change
 * reaches only the students who join after it.
 */
export function StandardHoursForm({
  programId,
  standardMinutes,
  standardDays,
  hourBank,
}: {
  programId: string;
  standardMinutes: number | null;
  standardDays: number | null;
  /** Where the time lands: the student's hour bank, or their unassigned pool. */
  hourBank: boolean;
}) {
  const minutesId = useId();
  const daysId = useId();
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
      description={
        standardMinutes !== null && standardDays !== null
          ? `Every student who joins gets ${formatDuration(standardMinutes)} ${hourBank ? "in their hour bank" : "unassigned"}, to use within ${standardDays} day${standardDays === 1 ? "" : "s"}. A change reaches only later joiners.`
          : "Off. Set both boxes to give every student who joins the same time."
      }
      control={
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="programId" value={programId} />
          <div>
            <label htmlFor={minutesId} className={labelClass}>
              Minutes
            </label>
            <Input
              id={minutesId}
              name="minutes"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              placeholder="e.g. 600"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              className="w-28"
            />
          </div>
          <div>
            <label htmlFor={daysId} className={labelClass}>
              Use within (days)
            </label>
            <Input
              id={daysId}
              name="days"
              type="number"
              inputMode="numeric"
              min="1"
              max="1095"
              step="1"
              placeholder="e.g. 90"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              className="w-28"
            />
          </div>
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
 * level inherits the program's.
 */
export function LevelStandardHoursForm({
  levelId,
  levelName,
  standardMinutes,
  standardDays,
  hourBank,
}: {
  levelId: string;
  levelName: string;
  standardMinutes: number | null;
  standardDays: number | null;
  hourBank: boolean;
}) {
  const minutesId = useId();
  const daysId = useId();
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
      description={
        standardMinutes !== null && standardDays !== null
          ? `Every student who joins ${levelName} gets ${formatDuration(standardMinutes)} ${hourBank ? "in their hour bank" : "unassigned"}, to use within ${standardDays} day${standardDays === 1 ? "" : "s"}. A change reaches only later joiners.`
          : `Inherits the program's. Set both to give ${levelName} its own, instead of allocating by hand.`
      }
      control={
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="levelId" value={levelId} />
          <div>
            <label htmlFor={minutesId} className={labelClass}>
              Minutes
            </label>
            <Input
              id={minutesId}
              name="minutes"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              placeholder="e.g. 600"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              className="w-28"
            />
          </div>
          <div>
            <label htmlFor={daysId} className={labelClass}>
              Use within (days)
            </label>
            <Input
              id={daysId}
              name="days"
              type="number"
              inputMode="numeric"
              min="1"
              max="1095"
              step="1"
              placeholder="e.g. 90"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              className="w-28"
            />
          </div>
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
        label={archived ? `Reopen ${programName}` : `Archive ${programName}`}
        question={
          archived
            ? "It comes back to the pickers and the lists it left."
            : "It leaves the pickers and the lists. Every session and allocation stays where it is."
        }
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
        label={`Delete ${programName}`}
        question="This removes the program and its empty cohorts."
        confirmLabel="Yes, delete it"
        pendingLabel="Deleting…"
        disabledReason={blockedReason}
      />
      <SaveState state={save} />
    </div>
  );
}
