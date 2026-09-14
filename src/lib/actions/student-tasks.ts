"use server";

import { revalidatePath } from "next/cache";

import { assertTaskAssigner, assertTaskScope } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { NOTIFICATION_TYPES } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { notify, notificationHref } from "@/lib/notify";
import {
  MAX_TASK_NOTE,
  MAX_TASK_TITLE,
  parsePercentField,
} from "@/lib/student-tasks";
import { parseDateField, type ActionState } from "@/lib/actions/shared";

/**
 * Work a mentor sets a student, and the student's own progress on it.
 *
 * The other half of the week from `actions/assignments.ts`, and the division is
 * who writes. An AGENDA item is planned by an admin, budgeted in minutes, and
 * moved by the hours a mentor logs against it. A TASK is set by the mentor the
 * student actually sits with, carries no hours at all, and is moved by nobody
 * but the student — which is the only reason it is a second table.
 *
 * So there are two gates here rather than one, and they never overlap:
 *
 *   `assertTaskAssigner`  may this person SET work here? A mentor who works in
 *                         the program, or an admin of it. Asked on create,
 *                         where there is no row yet to ask about.
 *   `assertTaskScope`     may this person CHANGE this row? The mentor whose
 *                         task it is, or an admin of the task's own program —
 *                         the same rule an agenda item's edits go through.
 *
 * And the student, who may do exactly one thing: say how far along they are.
 * That is checked against the row's own `studentId`, never against a role, so a
 * student cannot move somebody else's task by posting its id.
 *
 * Every refusal about a row that exists reads identically to one about a row
 * that does not, so none of them can be used to find out what is there.
 */

/** Title, deadline and note — the three things a mentor is asked. */
function parseFields(
  formData: FormData
):
  | { error: string }
  | { title: string; dueOn: Date; note: string | null } {
  const title = String(formData.get("title") ?? "").trim().replace(/\s+/g, " ");
  if (!title) return { error: "Say what the task is." };
  if (title.length > MAX_TASK_TITLE) {
    return { error: `Keep the task under ${MAX_TASK_TITLE} characters.` };
  }

  // Required, unlike an agenda item's due date. A task is given at one meeting
  // to be done before the next, and a task with no date is a suggestion the
  // student's home has no way to sort or chase.
  const dueOn = parseDateField(formData.get("dueOn"));
  if ("error" in dueOn) {
    return { error: "Give the task a deadline — that is what makes it one." };
  }

  const note = String(formData.get("note") ?? "").trim();
  if (note.length > MAX_TASK_NOTE) {
    return { error: `Keep the note under ${MAX_TASK_NOTE} characters.` };
  }

  return { title, dueOn: dueOn.value, note: note || null };
}

/** Set a student a piece of work, in one of the programs they study in. */
export async function setStudentTask(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const studentProfileId = String(formData.get("studentProfileId") ?? "");
  const programId = String(formData.get("programId") ?? "");
  const student = await prisma.studentProfile.findUnique({
    where: { id: studentProfileId },
    include: { user: true, enrollments: { select: { programId: true } } },
  });
  if (!student) return { ok: false, error: "That student no longer exists." };

  const denied = await assertTaskAssigner(actor, student, programId);
  if (denied) return denied;

  const fields = parseFields(formData);
  if ("error" in fields) return { ok: false, error: fields.error };

  /**
   * The mentor on the row is the ACTOR, never a field.
   *
   * An admin setting a task owns it themselves rather than assigning it to
   * somebody else's name — which is the difference from an agenda item, where
   * naming the mentor IS the act and the row can wait without one. A task with
   * a mentor's name on it that they did not set is a task the student will ask
   * them about and they will not recognise.
   */
  await prisma.$transaction(async (tx) => {
    await tx.studentTask.create({
      data: {
        studentId: student.id,
        programId,
        mentorId: actor.id,
        title: fields.title,
        note: fields.note,
        dueOn: fields.dueOn,
      },
    });
    await notify(tx, {
      to: [student.userId],
      type: NOTIFICATION_TYPES.TASK_SET,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `${actor.name ?? actor.email} set you a task: "${fields.title}", due ${formatDate(fields.dueOn)}.`,
    });
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `"${fields.title}" is on their list, due ${formatDate(fields.dueOn)}.`,
  };
}

/** Correct a task: any of its title, deadline and note. */
export async function updateStudentTask(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const id = String(formData.get("taskId") ?? "");
  const existing = await prisma.studentTask.findUnique({
    where: { id },
    include: { student: { select: { userId: true } } },
  });
  if (!existing || (await assertTaskScope(actor, existing))) {
    return { ok: false, error: "That task no longer exists." };
  }

  const fields = parseFields(formData);
  if ("error" in fields) return { ok: false, error: fields.error };

  // What this save actually CHANGES, which is the whole notice rather than a
  // decoration on it — the same lesson `updateAssignment` records: a form that
  // posts every field back turns "I fixed a typo" into "your task was updated,
  // due November 27", and a student who reads three of those stops reading the
  // fourth.
  const news: string[] = [];
  if (fields.title !== existing.title) {
    news.push(`now "${fields.title}"`);
  }
  if (fields.dueOn.getTime() !== existing.dueOn.getTime()) {
    news.push(`due ${formatDate(fields.dueOn)}`);
  }
  if (fields.note !== existing.note) {
    news.push(fields.note ? "a new note on it" : "the note taken off");
  }
  if (news.length === 0) return { ok: true, message: "Nothing changed." };

  await prisma.$transaction(async (tx) => {
    await tx.studentTask.update({ where: { id }, data: fields });
    await notify(tx, {
      to: [existing.student.userId],
      type: NOTIFICATION_TYPES.TASK_CHANGED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `Your task "${existing.title}" changed: ${news.join(", ")}.`,
    });
  });

  revalidatePath("/", "layout");
  return { ok: true, message: `"${fields.title}" updated.` };
}

/**
 * Withdraw a task. Nothing is at stake — no hours were budgeted against it and
 * no session was logged into it — so a task set by mistake is simply deleted,
 * and the student is told rather than left looking for a row that vanished.
 */
export async function deleteStudentTask(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const id = String(formData.get("taskId") ?? "");
  const existing = await prisma.studentTask.findUnique({
    where: { id },
    include: { student: { select: { userId: true } } },
  });
  if (!existing || (await assertTaskScope(actor, existing))) {
    return { ok: false, error: "That task no longer exists." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.studentTask.delete({ where: { id } });
    await notify(tx, {
      to: [existing.student.userId],
      type: NOTIFICATION_TYPES.TASK_CHANGED,
      actorId: actor.id,
      href: notificationHref.studentHome(),
      message: `"${existing.title}" was taken off your list — you no longer need to do it.`,
    });
  });

  revalidatePath("/", "layout");
  return { ok: true, message: `"${existing.title}" withdrawn.` };
}

/**
 * The student says how far along they are — the one write on this row that is
 * theirs, and the only reason a task is not an agenda item.
 *
 * 100 is not "done". Reaching the last step and calling the thing finished are
 * two different claims, and a control that conflated them would have no way to
 * say "I've written the whole draft and I'm still checking it". So `percent`
 * moves freely and `completedAt` is stamped only by the Done button, which is
 * also the only thing the mentor is told about in those words.
 */
export async function setStudentTaskProgress(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to do that." };

  const id = String(formData.get("taskId") ?? "");
  const task = await prisma.studentTask.findUnique({
    where: { id },
    include: { student: { select: { userId: true, user: true } } },
  });
  // "Not yours" and "does not exist" answer identically, so the refusal cannot
  // be used to find out whose tasks exist.
  if (!task || task.student.userId !== user.id) {
    return { ok: false, error: "That task is not yours." };
  }

  // Three things this one control can submit: a percentage, "I'm done", and
  // "I spoke too soon". They share an action because they are one question
  // asked in one place, and splitting them would let two of the three write a
  // state the third contradicts.
  const intent = String(formData.get("intent") ?? "percent");
  const name = task.student.user.name ?? task.student.user.email;

  if (intent === "done") {
    if (task.completedAt) return { ok: true, message: "Already done." };
    await prisma.$transaction(async (tx) => {
      await tx.studentTask.update({
        where: { id },
        data: { percent: 100, completedAt: new Date() },
      });
      await notify(tx, {
        to: [task.mentorId],
        type: NOTIFICATION_TYPES.TASK_MOVED,
        actorId: user.id,
        href: notificationHref.mentorStudent(task.studentId),
        message: `${name} finished "${task.title}".`,
      });
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `"${task.title}" is done.` };
  }

  if (intent === "reopen") {
    if (!task.completedAt) return { ok: true, message: "It isn't finished yet." };
    await prisma.$transaction(async (tx) => {
      // Back to 75, not to 0: the student is saying "not quite", and a control
      // that answered by wiping every step they had recorded would be punishing
      // them for correcting themselves.
      await tx.studentTask.update({
        where: { id },
        data: { percent: 75, completedAt: null },
      });
      await notify(tx, {
        to: [task.mentorId],
        type: NOTIFICATION_TYPES.TASK_MOVED,
        actorId: user.id,
        href: notificationHref.mentorStudent(task.studentId),
        message: `${name} reopened "${task.title}" — it isn't finished after all.`,
      });
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `"${task.title}" is open again.` };
  }

  const parsed = parsePercentField(formData.get("percent"));
  if ("error" in parsed) return { ok: false, error: parsed.error };
  if (parsed.value === task.percent && !task.completedAt) {
    return { ok: true, message: "No change." };
  }

  // Moving the percentage of a finished task reopens it: the student is saying
  // it is 50% done, which cannot be true of something they also called
  // finished. That reopening IS news, where a nudge from 25 to 50 is not — a
  // student walking a task up in four taps would otherwise send their mentor
  // four notifications about one afternoon, and a feed that always arrives is
  // one nobody reads.
  const reopened = task.completedAt != null;
  await prisma.$transaction(async (tx) => {
    await tx.studentTask.update({
      where: { id },
      data: { percent: parsed.value, completedAt: null },
    });
    if (reopened) {
      await notify(tx, {
        to: [task.mentorId],
        type: NOTIFICATION_TYPES.TASK_MOVED,
        actorId: user.id,
        href: notificationHref.mentorStudent(task.studentId),
        message: `${name} put "${task.title}" back to ${parsed.value}% — it isn't finished after all.`,
      });
    }
  });

  revalidatePath("/", "layout");
  return { ok: true, message: `Saved — ${parsed.value}%.` };
}
