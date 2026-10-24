import "server-only";

import { nameOf } from "@/lib/api/v1/sessions";
import type { ApiMentorTask, MentorTasks } from "@/lib/api/v1/types";
import { canActAsMentor } from "@/lib/constants";
import { toDateInputValue } from "@/lib/format";
import { mentorOwnTasks } from "@/lib/mentor-tasks";
import { prisma } from "@/lib/prisma";
import { daysAway, programToday } from "@/lib/when";
import type { User } from "@/generated/prisma/client";

/**
 * The tasks a program's admin gave a mentor, for the freshlog app.
 *
 * The rows are `mentorOwnTasks`, the website's `/mentor` read. Its comment says
 * open ones come first and its query orders by due day alone, so a task done
 * yesterday can sit above one still open. The website's function stays as it is;
 * the order the comment promises is made here.
 */

type ShareRow = Awaited<ReturnType<typeof mentorOwnTasks>>[number];

/**
 * One share in the contract's shape. `overdue` is `MentorTaskDue`'s rule, not
 * a student task's: a mentor task is late from the day after its due day, and a
 * finished one is never late.
 */
function toApiMentorTask(row: ShareRow, now: Date): ApiMentorTask {
  const done = row.completedAt !== null;
  const daysLeft = daysAway(row.task.dueOn, now);
  return {
    id: row.id,
    taskId: row.taskId,
    program: { id: row.task.program.id, name: row.task.program.name, colorIndex: row.task.program.colorIndex },
    from: { id: row.task.createdBy.id, name: nameOf(row.task.createdBy) },
    title: row.task.title,
    note: row.task.note,
    due: toDateInputValue(row.task.dueOn),
    daysLeft,
    overdue: !done && daysLeft < 0,
    done,
    completedAt: row.completedAt?.toISOString() ?? null,
    about: row.task.students.map(({ student }) => ({
      id: student.id,
      userId: student.user.id,
      name: nameOf(student.user),
    })),
  };
}

/**
 * Open shares by due day, then the ones finished in the last fortnight, latest
 * first. `null` for somebody who cannot act as a mentor: they have no such list,
 * and the route answers them like a page that does not exist.
 */
export async function mentorTasksFor(user: User, now: Date = new Date()): Promise<MentorTasks | null> {
  if (!canActAsMentor(user)) return null;
  const rows = await mentorOwnTasks(user.id, now);
  const open = rows
    .filter((r) => r.completedAt === null)
    .sort((a, b) => a.task.dueOn.getTime() - b.task.dueOn.getTime() || a.task.createdAt.getTime() - b.task.createdAt.getTime());
  const done = rows
    .filter((r) => r.completedAt !== null)
    .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());
  return { items: [...open, ...done].map((r) => toApiMentorTask(r, now)), today: programToday(now) };
}

/**
 * The reader's own share; `null` when it is somebody else's or was never made,
 * which the route answers alike.
 */
export async function mentorShareFor(user: User, id: string): Promise<{ id: string } | null> {
  return prisma.mentorTaskAssignee.findFirst({ where: { id, mentorId: user.id }, select: { id: true } });
}
