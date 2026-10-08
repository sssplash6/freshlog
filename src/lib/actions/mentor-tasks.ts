"use server";

import { revalidatePath } from "next/cache";

import { assertProgramScope } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { NOTIFICATION_TYPES } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import {
  MAX_MENTOR_TASK_NOTE,
  MAX_MENTOR_TASK_TITLE,
  programTeam,
} from "@/lib/mentor-tasks";
import { notify, notificationHref } from "@/lib/notify";
import { parseDateField, type ActionState } from "@/lib/actions/shared";

/**
 * Work a program's admin sets its mentors, and each mentor's own "done".
 *
 * Two gates, never overlapping:
 *
 *   `assertProgramScope`  may this person SET or WITHDRAW a task here? An
 *                         admin of the program — write scope, so a LEADER or
 *                         SALES grant reads the list and changes nothing.
 *   the assignee row      may this person FINISH this share? Only the mentor
 *                         whose share it is, checked against the row's own
 *                         `mentorId`, never a role.
 *
 * Every refusal about a row that exists reads identically to one about a row
 * that does not.
 */

const GONE = "That task no longer exists.";

/** The ids a multi-pick posted, once each. */
function idsOf(formData: FormData, name: string): string[] {
  return [
    ...new Set(
      formData
        .getAll(name)
        .map((v) => String(v).trim())
        .filter(Boolean)
    ),
  ];
}

/** Set one task to one mentor, several, or the whole team. */
export async function setMentorTask(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const programId = String(formData.get("programId") ?? "");
  const denied = await assertProgramScope(actor, programId);
  if (denied) return denied;

  const title = String(formData.get("title") ?? "").trim().replace(/\s+/g, " ");
  if (!title) return { ok: false, error: "Say what the task is." };
  if (title.length > MAX_MENTOR_TASK_TITLE) {
    return { ok: false, error: `Keep the task under ${MAX_MENTOR_TASK_TITLE} characters.` };
  }

  const dueOn = parseDateField(formData.get("dueOn"));
  if ("error" in dueOn) {
    return { ok: false, error: "Give the task a deadline." };
  }

  const note = String(formData.get("note") ?? "").trim();
  if (note.length > MAX_MENTOR_TASK_NOTE) {
    return { ok: false, error: `Keep the note under ${MAX_MENTOR_TASK_NOTE} characters.` };
  }

  // Only this program's own team. A posted id outside it is refused whole
  // rather than dropped, so nobody is told a task went to five mentors when it
  // went to four.
  const team = new Set((await programTeam(programId)).map((m) => m.id));
  const mentorIds = idsOf(formData, "mentorIds");
  if (mentorIds.length === 0) {
    return { ok: false, error: "Pick at least one mentor." };
  }
  if (mentorIds.some((id) => !team.has(id))) {
    return { ok: false, error: "One of those mentors is no longer in this program." };
  }

  // And only this program's own students — the same rule as the mentors, and
  // the reason an admin of one program cannot name somebody from another.
  const studentIds = idsOf(formData, "studentIds");
  if (studentIds.length > 0) {
    const found = await prisma.studentProfile.count({
      where: { id: { in: studentIds }, enrollments: { some: { programId } } },
    });
    if (found !== studentIds.length) {
      return { ok: false, error: "One of those students is no longer in this program." };
    }
  }

  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { name: true },
  });
  if (!program) return { ok: false, error: "You don't administer that program." };

  await prisma.$transaction(async (tx) => {
    await tx.mentorTask.create({
      data: {
        programId,
        title,
        note: note || null,
        dueOn: dueOn.value,
        createdById: actor.id,
        assignees: { create: mentorIds.map((mentorId) => ({ mentorId })) },
        students: { create: studentIds.map((studentId) => ({ studentId })) },
      },
    });
    await notify(tx, {
      to: mentorIds,
      type: NOTIFICATION_TYPES.MENTOR_TASK_SET,
      actorId: actor.id,
      href: notificationHref.mentorHome(),
      message: `${actor.name ?? actor.email} set you a task in ${program.name}: "${title}", due ${formatDate(dueOn.value)}.`,
    });
  });

  revalidatePath("/", "layout");
  const who =
    mentorIds.length === team.size && team.size > 1
      ? "the whole team"
      : mentorIds.length === 1
        ? "1 mentor"
        : `${mentorIds.length} mentors`;
  return { ok: true, message: `"${title}" set for ${who}.` };
}

/** A mentor finishes their share, or takes the tick back. */
export async function setMentorTaskDone(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const id = String(formData.get("assigneeId") ?? "");
  const share = await prisma.mentorTaskAssignee.findUnique({
    where: { id },
    include: { task: { select: { title: true, programId: true, createdById: true } } },
  });
  if (!share || share.mentorId !== actor.id) return { ok: false, error: GONE };

  const done = String(formData.get("intent") ?? "") === "done";
  if (done === Boolean(share.completedAt)) {
    return { ok: true, message: done ? "Already done." : "It isn't finished yet." };
  }

  await prisma.$transaction(async (tx) => {
    // Conditional on the state just read, so a double tap cannot stamp twice
    // or tell the admin twice.
    const moved = await tx.mentorTaskAssignee.updateMany({
      where: { id, completedAt: done ? null : { not: null } },
      data: { completedAt: done ? new Date() : null },
    });
    if (moved.count === 0 || !done) return;
    await notify(tx, {
      to: [share.task.createdById],
      type: NOTIFICATION_TYPES.MENTOR_TASK_DONE,
      actorId: actor.id,
      href: `${notificationHref.adminProgram(share.task.programId)}/tasks`,
      message: `${actor.name ?? actor.email} finished "${share.task.title}".`,
    });
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: done ? `"${share.task.title}" is done.` : `"${share.task.title}" is open again.`,
  };
}

/** Withdraw a task from everyone it was set to. */
export async function deleteMentorTask(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const id = String(formData.get("taskId") ?? "");
  const task = await prisma.mentorTask.findUnique({ where: { id } });
  if (!task || (await assertProgramScope(actor, task.programId))) {
    return { ok: false, error: GONE };
  }

  await prisma.mentorTask.delete({ where: { id } });
  revalidatePath("/", "layout");
  return { ok: true, message: `"${task.title}" withdrawn.` };
}
