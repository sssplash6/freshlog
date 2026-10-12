"use client";

import { useState } from "react";

import {
  deleteStudent,
  enrollStudent,
  moveStudent,
  setStudentEmail,
  setStudentFolder,
  setStudentName,
  setStudentTelegram,
  unenrollStudent,
} from "@/lib/actions/students";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import { Labelled } from "@/components/forms/labelled";
import { Select } from "@/components/select";
import { EmailInput, Field, Input, NameInput } from "@/components/ui/field";
import { RowActionGroup, RowActionMenu } from "@/components/ui/row-action-menu";
import { SaveState, useSaveState } from "@/components/ui/save-state";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ProgramOption } from "@/lib/queries";

/**
 * The facts about a student that only staff may correct, each as a "Change"
 * beside the fact itself rather than a panel of its own.
 *
 * They were three stacked panels — Corrections, Folder, and a Callout — which
 * put the rarest controls on the page in the same visual weight as the ledger
 * everybody opens it for. A fact and the way to change it belong on one line;
 * `FactList` gives them one, and each control is a menu so an accidental tap
 * cannot edit an email address.
 */

/**
 * The name everyone reads them by, correctable by the two people who ever
 * find out it is wrong: an admin of one of their programs, and a mentor who
 * works with them.
 *
 * It sits beside the h1 rather than in the Details panel below, and that is
 * the point of it. Details is admin-only — it holds a sign-in address and a
 * set of enrollments — and a mentor needs neither of those to fix a spelling.
 * The name is the one fact on this page that both readers own, so the pencil
 * lives on the fact itself.
 */
export function StudentNameChange({
  studentProfileId,
  currentName,
}: {
  studentProfileId: string;
  currentName: string | null;
}) {
  const [, action, save] = useSaveState(setStudentName);
  return (
    <RowActionMenu trigger="pencil" label="Change their name">
      <RowActionGroup label="Full name">
        <form action={action} className="space-y-2">
          <input type="hidden" name="studentProfileId" value={studentProfileId} />
          <Field label="Name">
            <NameInput name="name" required defaultValue={currentName ?? ""} />
          </Field>
          <SubmitButton size="sm">Save name</SubmitButton>
          <SaveState state={save} />
        </form>
      </RowActionGroup>
    </RowActionMenu>
  );
}

/**
 * The handle their mentors message them on.
 *
 * A student sets this at first sign-in and it was read-only here forever
 * after, so one wrong character made them unreachable and nobody on the staff
 * side could correct it — while the row above it, an email address, has had a
 * pencil all along.
 */
export function StudentTelegramChange({
  studentProfileId,
  currentHandle,
}: {
  studentProfileId: string;
  currentHandle: string | null | undefined;
}) {
  const [, action, save] = useSaveState(setStudentTelegram);
  return (
    <RowActionMenu trigger="pencil" label="Change Telegram handle">
      <RowActionGroup label="Telegram">
        <form action={action} className="space-y-2">
          <input type="hidden" name="studentProfileId" value={studentProfileId} />
          <Field label="Username">
            <Input
              name="telegramUsername"
              type="text"
              required
              placeholder="username"
              defaultValue={currentHandle ?? ""}
            />
          </Field>
          <SubmitButton size="sm">Save handle</SubmitButton>
          <SaveState state={save} />
        </form>
      </RowActionGroup>
    </RowActionMenu>
  );
}

/**
 * The address they sign in with. Students brought over from the tracking sheet
 * start with a placeholder and cannot sign in at all until it is their real
 * one, which is why this is not a rare edit in practice.
 */
export function StudentEmailChange({
  studentProfileId,
  currentEmail,
}: {
  studentProfileId: string;
  currentEmail: string;
}) {
  const [, action, save] = useSaveState(setStudentEmail);
  return (
    <RowActionMenu trigger="pencil" label="Change sign-in email">
      <RowActionGroup label="Sign-in email">
        <form action={action} className="space-y-2">
          <input type="hidden" name="studentProfileId" value={studentProfileId} />
          <Field label="Email">
            <EmailInput
              name="email"
              required
              defaultValue={currentEmail}
            />
          </Field>
          <SubmitButton size="sm">Save email</SubmitButton>
          <SaveState state={save} />
        </form>
      </RowActionGroup>
    </RowActionMenu>
  );
}

/**
 * A student's programs: the ones they are in, a way out of each, and a way
 * into another.
 *
 * One menu with three verbs rather than three controls, because they are one
 * question — "where does this person study?" — and because the answer is
 * usually one line long. What each verb does is deliberately different:
 *
 *   Move       corrects a mis-enrollment. It changes the membership and moves
 *              nothing else: the hours, sessions and tasks name the program
 *              they were granted in, and they stay there.
 *   Enroll     adds a program alongside the ones they have. This is Global
 *              Admissions and then the Master's Program — the ordinary path
 *              through this school — and it grants no hours; that is the next
 *              act, on the grants table, per program.
 *   Remove     takes them off one program. Refused once anything happened in
 *              it, and refused for the last one, with the reason said out loud
 *              by the action rather than by a disabled button.
 */
export function StudentPrograms({
  studentProfileId,
  programs,
  enrollments,
}: {
  studentProfileId: string;
  programs: ProgramOption[];
  enrollments: {
    id: string;
    programId: string;
    levelId: string | null;
    cohortId: string | null;
    label: string;
  }[];
}) {
  return (
    <RowActionMenu trigger="pencil" label="Change programs">
      <RowActionGroup label={enrollments.length === 1 ? "Program" : "Programs"}>
        <div className="space-y-4">
          {enrollments.map((e) => (
            <MoveEnrollment
              key={e.id}
              studentProfileId={studentProfileId}
              programs={programs}
              enrollment={e}
              removable={enrollments.length > 1}
            />
          ))}
        </div>
      </RowActionGroup>
      {/* Only while there is somewhere left to add them. */}
      {programs.some((p) => !enrollments.some((e) => e.programId === p.id)) && (
        <RowActionGroup label="Add a program">
          <EnrollInProgram
            studentProfileId={studentProfileId}
            programs={programs.filter(
              (p) => !enrollments.some((e) => e.programId === p.id)
            )}
          />
        </RowActionGroup>
      )}
    </RowActionMenu>
  );
}

/** One enrollment: move it somewhere else, or take it away. */
function MoveEnrollment({
  studentProfileId,
  programs,
  enrollment,
  removable,
}: {
  studentProfileId: string;
  programs: ProgramOption[];
  enrollment: {
    id: string;
    programId: string;
    levelId: string | null;
    cohortId: string | null;
    label: string;
  };
  removable: boolean;
}) {
  const [, action, save] = useSaveState(moveStudent);
  const [, remove, removeSave] = useSaveState(unenrollStudent);
  const [programId, setProgramId] = useState(enrollment.programId);
  const program = programs.find((p) => p.id === programId) ?? null;
  const [levelId, setLevelId] = useState(enrollment.levelId ?? "");
  const level = program?.levels.find((l) => l.id === levelId) ?? null;
  const cohorts = program
    ? program.levels.length > 0
      ? (level?.cohorts ?? [])
      : program.cohorts
    : [];

  return (
    <div className="space-y-2">
      <form action={action} className="space-y-2">
        <input type="hidden" name="studentProfileId" value={studentProfileId} />
        <input type="hidden" name="enrollmentId" value={enrollment.id} />
        <PlacementFields
          label={enrollment.label}
          programs={programs}
          program={program}
          programId={programId}
          levelId={levelId}
          cohorts={cohorts}
          onProgram={(id) => {
            setProgramId(id);
            setLevelId("");
          }}
          onLevel={setLevelId}
          cohortDefault={
            programId === enrollment.programId && levelId === enrollment.levelId
              ? (enrollment.cohortId ?? "")
              : ""
          }
        />
        <SubmitButton size="sm">Move</SubmitButton>
        <SaveState state={save} />
      </form>
      {removable && (
        <ConfirmInline
          variant="quiet"
          label="Remove from program"
          question={`Take them off ${enrollment.label}?`}
          confirmLabel="Yes, remove"
          action={remove}
          values={{ enrollmentId: enrollment.id }}
          pending={removeSave.kind === "saving"}
        />
      )}
      <SaveState state={removeSave} />
    </div>
  );
}

/**
 * Program, then its level and cohort where it has them — the same three
 * questions for a move and for an enrollment. Each picker remounts when the
 * one above it changes, so a choice made under one program cannot be
 * submitted under another.
 */
function PlacementFields({
  label,
  programs,
  program,
  programId,
  levelId,
  cohorts,
  onProgram,
  onLevel,
  cohortDefault = "",
}: {
  label: string;
  programs: ProgramOption[];
  program: ProgramOption | null;
  programId: string;
  levelId: string;
  cohorts: { id: string; name: string }[];
  onProgram: (id: string) => void;
  onLevel: (id: string) => void;
  cohortDefault?: string;
}) {
  return (
    <>
      <Labelled label={label}>
        <Select
          name="programId"
          ariaLabel="Program"
          options={programs.map((p) => ({ value: p.id, label: p.name }))}
          defaultValue={programId}
          onChange={onProgram}
        />
      </Labelled>
      {((program?.levels.length ?? 0) > 0 || cohorts.length > 0) && (
        <div className="grid grid-cols-2 gap-2">
          {(program?.levels.length ?? 0) > 0 && (
            <Labelled label="Level">
              <Select
                key={programId}
                name="levelId"
                ariaLabel="Level"
                options={(program?.levels ?? []).map((l) => ({ value: l.id, label: l.name }))}
                defaultValue={levelId}
                onChange={onLevel}
                measure="sm"
              />
            </Labelled>
          )}
          {cohorts.length > 0 && (
            <Labelled label="Cohort">
              <Select
                key={`${programId}:${levelId}`}
                name="cohortId"
                ariaLabel="Cohort"
                options={cohorts.map((c) => ({ value: c.id, label: c.name }))}
                defaultValue={cohortDefault}
                measure="sm"
              />
            </Labelled>
          )}
        </div>
      )}
    </>
  );
}

/** Add a program to a student who is already in one. */
function EnrollInProgram({
  studentProfileId,
  programs,
}: {
  studentProfileId: string;
  programs: ProgramOption[];
}) {
  const [, action, save] = useSaveState(enrollStudent);
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const program = programs.find((p) => p.id === programId) ?? null;
  const [levelId, setLevelId] = useState("");
  const level = program?.levels.find((l) => l.id === levelId) ?? null;
  const cohorts = program
    ? program.levels.length > 0
      ? (level?.cohorts ?? [])
      : program.cohorts
    : [];

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="studentProfileId" value={studentProfileId} />
      <PlacementFields
        label="Program"
        programs={programs}
        program={program}
        programId={programId}
        levelId={levelId}
        cohorts={cohorts}
        onProgram={(id) => {
          setProgramId(id);
          setLevelId("");
        }}
        onLevel={setLevelId}
      />
      <SubmitButton size="sm">Enroll</SubmitButton>
      <SaveState state={save} />
    </form>
  );
}

/** Where their work lives — a Drive folder, usually — for their mentors. */
export function StudentFolderChange({
  studentProfileId,
  currentFolderUrl,
}: {
  studentProfileId: string;
  currentFolderUrl: string | null;
}) {
  const [, action, save] = useSaveState(setStudentFolder);
  return (
    <RowActionMenu trigger="pencil" label="Change folder link">
      <RowActionGroup label="Folder">
        <form action={action} className="space-y-2">
          <input type="hidden" name="studentProfileId" value={studentProfileId} />
          <Field label="Link">
            <Input
              name="folderUrl"
              type="url"
              measure="lg"
              placeholder="https://drive.google.com/…"
              defaultValue={currentFolderUrl ?? ""}
            />
          </Field>
          <SubmitButton size="sm">Save link</SubmitButton>
          <SaveState state={save} />
        </form>
      </RowActionGroup>
    </RowActionMenu>
  );
}

/**
 * Removing the record entirely. Refused while any session still stands against
 * them — the sessions are the ledger, and a ledger with a hole in it is worse
 * than a student who left. Voided ones are retractions, and go with the record.
 */
export function RemoveStudentButton({
  studentProfileId,
  name,
  hasSessions,
}: {
  studentProfileId: string;
  name: string;
  hasSessions: boolean;
}) {
  const [, action, save] = useSaveState(deleteStudent);
  return (
    <div className="space-y-2">
      <ConfirmInline
        variant="quiet"
        // Red only while it can be pressed. Disabled, a dimmed red word still
        // read as a live destructive action beside its "can't" reason.
        tone={hasSessions ? "primary" : "danger"}
        label="Remove student"
        question={`Remove ${name}?`}
        confirmLabel="Yes, remove them"
        action={action}
        values={{ studentProfileId }}
        pending={save.kind === "saving"}
        disabledReason={
          hasSessions
            ? "Has sessions. Void them first."
            : undefined
        }
      />
      <SaveState state={save} />
    </div>
  );
}
