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
import { EmailInput, Field, Input, inputClasses, NameInput } from "@/components/ui/field";
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

const selectClass = inputClasses;

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
          <Field label="Name" hint="First and last name.">
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
          <Field label="Username" hint="With or without the @.">
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
  enrollments: { id: string; programId: string; cohortId: string | null; label: string }[];
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
      <RowActionGroup label="Add a program">
        <EnrollInProgram
          studentProfileId={studentProfileId}
          programs={programs.filter(
            (p) => !enrollments.some((e) => e.programId === p.id)
          )}
        />
      </RowActionGroup>
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
  enrollment: { id: string; programId: string; cohortId: string | null; label: string };
  removable: boolean;
}) {
  const [, action, save] = useSaveState(moveStudent);
  const [, remove, removeSave] = useSaveState(unenrollStudent);
  const [programId, setProgramId] = useState(enrollment.programId);
  const cohorts = programs.find((p) => p.id === programId)?.cohorts ?? [];

  return (
    <div className="space-y-2">
      <form action={action} className="space-y-2">
        <input type="hidden" name="studentProfileId" value={studentProfileId} />
        <input type="hidden" name="enrollmentId" value={enrollment.id} />
        <Field label={enrollment.label}>
          <select
            name="programId"
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            className={selectClass}
          >
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        {cohorts.length > 0 && (
          <Field label="Cohort">
            <select
              name="cohortId"
              defaultValue={enrollment.cohortId ?? ""}
              className={selectClass}
            >
              <option value="">No cohort</option>
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <SubmitButton size="sm">Move</SubmitButton>
        <SaveState state={save} />
      </form>
      {removable && (
        <form action={remove}>
          <input type="hidden" name="enrollmentId" value={enrollment.id} />
          <SubmitButton size="sm" variant="ghost">
            Take off {enrollment.label}
          </SubmitButton>
          <SaveState state={removeSave} />
        </form>
      )}
    </div>
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
  const cohorts = programs.find((p) => p.id === programId)?.cohorts ?? [];

  if (programs.length === 0) {
    return (
      <p className="text-xs text-muted-fg">
        They are already in every program you administer.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="studentProfileId" value={studentProfileId} />
      <Field label="Program">
        <select
          name="programId"
          value={programId}
          onChange={(e) => setProgramId(e.target.value)}
          className={selectClass}
        >
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      {cohorts.length > 0 && (
        <Field label="Cohort">
          <select name="cohortId" defaultValue="" className={selectClass}>
            <option value="">No cohort</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
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
          <Field label="Link" hint="Leave empty to remove it.">
            <Input
              name="folderUrl"
              type="url"
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
 * Removing the record entirely. Refused once anything has been logged against
 * them — the sessions are the ledger, and a ledger with a hole in it is worse
 * than a student who left.
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
        label="Remove student"
        question={`${name}'s record goes, with their agenda, their tasks and any time granted to them.`}
        confirmLabel="Yes, remove them"
        action={action}
        values={{ studentProfileId }}
        pending={save.kind === "saving"}
        disabledReason={
          hasSessions
            ? "Can't be removed: they have logged sessions."
            : undefined
        }
      />
      <SaveState state={save} />
    </div>
  );
}
