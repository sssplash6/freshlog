"use server";

import { revalidatePath } from "next/cache";

import { assertProgramScope, assertTaskScope } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import {
  ASSIGNMENT_PROGRESS,
  ASSIGNMENT_PROGRESS_AUTO,
  ASSIGNMENT_PROGRESS_LABELS,
  canActAsMentor,
  NOTIFICATION_TYPES,
} from "@/lib/constants";
import { formatDate, formatDuration } from "@/lib/format";
import { syncGoalProgress } from "@/lib/goal-progress";
import { notify, notificationHref } from "@/lib/notify";
import { parseTaskField } from "@/lib/tasks";
import {
  parseDateField,
  parseMinutesField,
  type ActionState,
} from "@/lib/actions/shared";

/**
 * The AGENDA half of a student's ledger: which mentor is doing what work, with
 * what hour budget, by when, and how far along it is. Only admins write here
 * (mentors and students read it), matching how the tracking spreadsheet was
 * run: the mentor fills the meetings log by logging sessions, the admin plans
 * the work.
 *
 * `Assignment` is the model and "agenda" is the word the UI now uses for it, to
 * tell it from a `StudentTask` — the other thing the team calls a task, which a
 * mentor sets, carries no hours, and only the student can move. The split is
 * written out in `lib/student-tasks.ts`.
 *
 * An agenda item is BORN in setMentorAllocation, not here — planning work and
 * granting the hours for it are one act, so there is one form for both and the
 * item's budget is the hours it was given. What lives here is everything that
 * happens to it afterwards: editing it, stating its progress, removing it.
 *
 * Every write here is gated on its OWN program. It had none until 6 September
 * 2026 and borrowed the student's, which stopped meaning anything the moment a
 * student could be in two: the program that budgeted the work is the one an
 * admin either holds a grant for or does not. Anything outside that grant
 * answers "no longer exists" — the same sentence a deleted row gets, so the
 * refusal can't be used to confirm it is there.
 */

const PROGRESS_VALUES: string[] = Object.values(ASSIGNMENT_PROGRESS);
const MAX_DEADLINE = 60;
const MAX_NOTE = 500;

/** Every field an assignment row holds, validated together. */
function parseFields(
  formData: FormData
):
  | { error: string }
  | {
      purpose: string;
      dueNote: string | null;
      dueOn: Date | null;
      minuteLimit: number | null;
      note: string | null;
      progress: string;
    } {
  // Either a task off the shared list or one typed in its place — the same
  // vocabulary the allocation forms use, so the two ways of creating a task
  // can't drift into two sets of names.
  const task = parseTaskField(
    formData.get("purpose"),
    formData.get("purposeCustom")
  );
  if ("error" in task) return { error: task.error };
  const purpose = task.value;

  // Blank means "not budgeted yet", which is a normal state for a row an admin
  // is still thinking about — only a non-empty value has to be a valid number.
  const rawLimit = String(formData.get("minuteLimit") ?? "").trim();
  let minuteLimit: number | null = null;
  if (rawLimit) {
    const parsed = parseMinutesField(rawLimit, { min: 0, label: "The hour limit" });
    if ("error" in parsed) return { error: parsed.error };
    minuteLimit = parsed.value;
  }

  // Free text on purpose: the team writes both "August 7" and "March-May",
  // and the second is not a date. It is kept as somebody typed it and shown as
  // typed — it just cannot be compared to a clock.
  const dueNote = String(formData.get("dueNote") ?? "").trim();
  if (dueNote.length > MAX_DEADLINE) {
    return { error: `Keep the due note under ${MAX_DEADLINE} characters.` };
  }

  // The half a clock can read. Optional, because most tasks only ever have the
  // note — and only this one decides whether a task is overdue.
  const rawDue = String(formData.get("dueOn") ?? "").trim();
  let dueOn: Date | null = null;
  if (rawDue) {
    const parsed = parseDateField(formData.get("dueOn"));
    if ("error" in parsed) return { error: parsed.error };
    dueOn = parsed.value;
  }

  const note = String(formData.get("note") ?? "").trim();
  if (note.length > MAX_NOTE) {
    return { error: `Keep the note under ${MAX_NOTE} characters.` };
  }

  const progress = String(formData.get("progress") ?? ASSIGNMENT_PROGRESS.NOT_STARTED);
  if (!PROGRESS_VALUES.includes(progress)) {
    return { error: "Pick a progress state." };
  }

  return {
    purpose,
    minuteLimit,
    dueNote: dueNote || null,
    dueOn,
    note: note || null,
    progress,
  };
}

/** Edit a task: any of name, mentor, hour limit, deadline, progress, note. */
export async function updateAssignment(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const id = String(formData.get("assignmentId") ?? "");
  // Every scalar, `programId` included — the task now names its own program,
  // so the gate no longer has to reach through the student for it.
  const existing = await prisma.assignment.findUnique({ where: { id } });
  // "Not yours" and "does not exist" answer identically, so the refusal
  // cannot be used to find out which tasks exist.
  if (!existing || (await assertTaskScope(actor, existing))) {
    return { ok: false, error: "That agenda item no longer exists." };
  }

  // Empty = no mentor (yet): a task can be planned before anyone owns it,
  // and this same edit is how an unassigned task finally gets its mentor.
  const mentorId = String(formData.get("mentorId") ?? "").trim() || null;
  let newMentorName: string | null = null;
  if (mentorId) {
    const mentor = await prisma.user.findUnique({ where: { id: mentorId } });
    if (!mentor || !canActAsMentor(mentor)) {
      return { ok: false, error: "Pick a mentor." };
    }
    newMentorName = mentor.name ?? mentor.email;
  }

  const fields = parseFields(formData);
  if ("error" in fields) return { ok: false, error: fields.error };

  /**
   * What this save actually CHANGES — which is the whole notice, not a
   * decoration on it.
   *
   * The edit form posts every field back whether or not it was touched, so a
   * save that only fixed a note — or that touched nothing at all, because the
   * form was opened and saved — still told the mentor "was updated — now 6h,
   * due November 27". An admin doing a pass over a caseload therefore filled
   * every mentor's feed with a dozen near-identical sentences restating hours
   * nobody had moved, which is how a feed teaches people to stop reading it.
   */
  const handedOver = mentorId !== existing.mentorId;
  const news: string[] = [];
  if (fields.purpose !== existing.purpose) {
    news.push(`renamed from "${existing.purpose}"`);
  }
  if (fields.minuteLimit !== existing.minuteLimit) {
    news.push(
      fields.minuteLimit == null
        ? "no hour budget for now"
        : `now ${formatDuration(fields.minuteLimit)}`
    );
  }
  // Either half moving is a change to when the work is due, and the sentence
  // says whichever one the reader will actually see on the row.
  if (
    fields.dueNote !== existing.dueNote ||
    fields.dueOn?.getTime() !== existing.dueOn?.getTime()
  ) {
    const due = fields.dueNote ?? (fields.dueOn ? formatDate(fields.dueOn) : null);
    news.push(due ? `due ${due}` : "no due date now");
  }
  if (fields.progress !== existing.progress) {
    news.push(
      `marked ${ASSIGNMENT_PROGRESS_LABELS[fields.progress].toLowerCase()}`
    );
  }
  if (fields.note !== existing.note) {
    news.push(fields.note ? "a new note on it" : "the note taken off");
  }
  // Nothing to write, and nobody to tell about it.
  if (!handedOver && news.length === 0) {
    return { ok: true, message: "Nothing changed." };
  }

  const student = await prisma.studentProfile.findUnique({
    where: { id: existing.studentId },
    include: { user: true },
  });
  const studentName = student
    ? (student.user.name ?? student.user.email)
    : "a student";

  // Whose it WAS, for the hand-off copy below.
  const previousMentor =
    handedOver && existing.mentorId
      ? await prisma.user.findUnique({
          where: { id: existing.mentorId },
          select: { name: true, email: true },
        })
      : null;
  const previousMentorName = previousMentor
    ? (previousMentor.name ?? previousMentor.email)
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.assignment.update({
      where: { id },
      data: { mentorId, ...fields },
    });

    // Moving the hour limit can finish a goal outright or reopen it, so the
    // derived progress is recomputed unless an admin has pinned it.
    await syncGoalProgress(tx, id);

    if (handedOver) {
      // The two ends of a hand-off are opposite news, and the one sentence sent
      // to both — "was reassigned" — was the wrong half of the story for
      // whichever mentor read it: neither could tell whether the task had just
      // become theirs or just left their list, and a task getting its FIRST
      // mentor announced itself as a reassignment. notify() drops the actor, so
      // an admin moving work to themselves isn't told about their own change,
      // and an unassigned end of a hand-off is simply nobody to tell.
      const state = [
        fields.minuteLimit != null ? formatDuration(fields.minuteLimit) : null,
        fields.dueNote ?? (fields.dueOn ? `due ${formatDate(fields.dueOn)}` : null),
      ]
        .filter(Boolean)
        .join(", ");
      await notify(tx, {
        to: mentorId ? [mentorId] : [],
        type: NOTIFICATION_TYPES.GOAL_CHANGED,
        actorId: actor.id,
        href: notificationHref.mentorStudent(existing.studentId),
        message: `"${fields.purpose}" for ${studentName} is yours now${state ? ` — ${state}` : ""}.${previousMentorName ? ` It was ${previousMentorName}'s.` : ""}`,
      });
      await notify(tx, {
        to: existing.mentorId ? [existing.mentorId] : [],
        type: NOTIFICATION_TYPES.GOAL_CHANGED,
        actorId: actor.id,
        href: notificationHref.mentorStudent(existing.studentId),
        message: `"${fields.purpose}" for ${studentName} is no longer yours — ${newMentorName ? `it's ${newMentorName}'s now` : "it has no mentor until an admin assigns one"}.`,
      });
    } else {
      await notify(tx, {
        to: existing.mentorId ? [existing.mentorId] : [],
        type: NOTIFICATION_TYPES.GOAL_CHANGED,
        actorId: actor.id,
        href: notificationHref.mentorStudent(existing.studentId),
        message: `Your agenda item "${fields.purpose}" for ${studentName}: ${news.join(", ")}.`,
      });
    }
  });

  revalidatePath("/", "layout");
  return { ok: true, message: `"${fields.purpose}" updated.` };
}

/**
 * Flip just the progress state, for the one-click control on each row — the
 * edit form is far too much ceremony for marking something done.
 */
export async function setAssignmentProgress(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const id = String(formData.get("assignmentId") ?? "");
  const progress = String(formData.get("progress") ?? "");
  // Not a state, a release: hand the goal back to its hours.
  if (progress !== ASSIGNMENT_PROGRESS_AUTO && !PROGRESS_VALUES.includes(progress)) {
    return { ok: false, error: "Pick a progress state." };
  }

  // Every scalar, `programId` included — the task now names its own program,
  // so the gate no longer has to reach through the student for it.
  const existing = await prisma.assignment.findUnique({ where: { id } });
  // "Not yours" and "does not exist" answer identically, so the refusal
  // cannot be used to find out which tasks exist.
  if (!existing || (await assertTaskScope(actor, existing))) {
    return { ok: false, error: "That agenda item no longer exists." };
  }

  if (progress === ASSIGNMENT_PROGRESS_AUTO) {
    if (!existing.progressManual) {
      return { ok: true, message: "This already follows its hours." };
    }
    const synced = await prisma.$transaction(async (tx) => {
      await tx.assignment.update({
        where: { id },
        data: { progressManual: false },
      });
      return syncGoalProgress(tx, id);
    });
    revalidatePath("/", "layout");
    const label = ASSIGNMENT_PROGRESS_LABELS[
      synced?.to ?? existing.progress
    ].toLowerCase();
    return {
      ok: true,
      message: `"${existing.purpose}" follows its logged hours again, and reads as ${label}.`,
    };
  }

  if (existing.progress === progress && existing.progressManual) {
    return { ok: true, message: "No change." };
  }

  await prisma.$transaction(async (tx) => {
    // Stating progress by hand PINS it. Work finished under budget is done even
    // though the hours say otherwise, and later sessions must not reopen it.
    await tx.assignment.update({
      where: { id },
      data: { progress, progressManual: true },
    });
    await notify(tx, {
      to: existing.mentorId ? [existing.mentorId] : [],
      type: NOTIFICATION_TYPES.GOAL_CHANGED,
      actorId: actor.id,
      href: notificationHref.mentorStudent(existing.studentId),
      message: `An admin marked your agenda item "${existing.purpose}" as ${ASSIGNMENT_PROGRESS_LABELS[progress].toLowerCase()}.`,
    });
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `"${existing.purpose}" is now ${ASSIGNMENT_PROGRESS_LABELS[progress].toLowerCase()} and pinned there. Hours logged later won't change it.`,
  };
}

/**
 * Remove a row. Assignments are a plan, not a ledger — nothing draws down from
 * them and no hours are at stake, so a mistake can simply be deleted. The
 * sessions a mentor logged are untouched: they live on the other half.
 */
export async function deleteAssignment(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const id = String(formData.get("assignmentId") ?? "");
  // Every scalar, `programId` included — the task now names its own program,
  // so the gate no longer has to reach through the student for it.
  const existing = await prisma.assignment.findUnique({ where: { id } });
  // Removing a task stays an ADMIN write, where correcting one is not. A
  // mentor fixing the budget or the note on their own work is a correction; a
  // mentor deleting work an admin planned, and the hours budgeted against it,
  // is a decision about the plan. Voiding a session is the same distinction.
  if (!existing || (await assertProgramScope(actor, existing.programId))) {
    return { ok: false, error: "That agenda item no longer exists." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.assignment.delete({ where: { id } });
    await notify(tx, {
      to: existing.mentorId ? [existing.mentorId] : [],
      type: NOTIFICATION_TYPES.GOAL_CHANGED,
      actorId: actor.id,
      href: notificationHref.mentorStudent(existing.studentId),
      message: `The agenda item "${existing.purpose}" was removed from the plan. Sessions you already logged against it are kept.`,
    });
  });

  revalidatePath("/", "layout");
  return { ok: true, message: `"${existing.purpose}" removed from the plan.` };
}
