import "server-only";

import { nameOf, type Reader } from "@/lib/api/v1/sessions";
import type { ApiPlanItem, ApiTask } from "@/lib/api/v1/types";
import { mentorReaches, scopeCovers } from "@/lib/authz";
import { ASSIGNMENT_PROGRESS, canActAsMentor, SESSION_STATUS, USER_STATUS } from "@/lib/constants";
import { toDateInputValue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { daysAway } from "@/lib/when";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Tasks and plan items as the freshlog app reads them, one at a time.
 *
 * "Task" is a `StudentTask`, work a mentor set the student. A "plan item" is an
 * `Assignment`, the website's "agenda item": time budgeted for a purpose.
 * Neither has a page of its own on the website, so the read rule here is the
 * rule of the page they sit on, `/students/[id]`, and the change rule is
 * `assertTaskScope`'s and the progress action's, asked of a row in hand.
 */

/** The include every task read uses: the people and program the contract names, nothing more. */
export const TASK_INCLUDE = {
  student: { select: { id: true, userId: true, user: { select: { name: true, email: true } } } },
  mentor: { select: { id: true, name: true, email: true } },
  program: { select: { id: true, name: true, colorIndex: true } },
} satisfies Prisma.StudentTaskInclude;

export type TaskRow = Prisma.StudentTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

/** The include every plan item read uses. The mentor may be nobody yet. */
export const PLAN_ITEM_INCLUDE = {
  student: { select: { id: true, userId: true, user: { select: { name: true, email: true } } } },
  mentor: { select: { id: true, name: true, email: true } },
  program: { select: { id: true, name: true, colorIndex: true } },
} satisfies Prisma.AssignmentInclude;

export type PlanItemRow = Prisma.AssignmentGetPayload<{ include: typeof PLAN_ITEM_INCLUDE }>;

const isStudentOf = (reader: Reader, row: { studentId: string }) =>
  reader.studentProfileId !== null && row.studentId === reader.studentProfileId;

/**
 * May `reader` read this task or plan item: its own student, a mentor who
 * reaches the student (`canActAsMentor` and `mentorReaches`, the website's
 * `reaches`), or an admin of the row's own program.
 *
 * The row's program decides the admin half, never the student's enrollments
 * (AGENTS.md, "Ask the row, not the student").
 */
async function canReadWork(reader: Reader, row: { studentId: string; programId: string }): Promise<boolean> {
  if (isStudentOf(reader, row) || scopeCovers(reader.read, row.programId)) return true;
  return canActAsMentor(reader.user) && (await mentorReaches(reader.user, { id: row.studentId }));
}

/**
 * May `reader` change this row: the same two people `assertTaskScope` lets
 * through, asked of a row already in hand and answered with a boolean. The
 * owning mentor, while they are an active mentor, and anyone who may write the
 * row's program. A row with no mentor belongs to nobody, only to its admins.
 */
function changes(reader: Reader, row: { programId: string; mentorId: string | null }): boolean {
  const owns =
    row.mentorId === reader.user.id && canActAsMentor(reader.user) && reader.user.status === USER_STATUS.ACTIVE;
  return owns || scopeCovers(reader.write, row.programId);
}

/**
 * One task in the contract's shape, as `reader` may be told it. It takes a row
 * the reader may already see.
 *
 * `overdue` is freshform's TASK_OVERDUE rule (`taskStatuses`): not done, and the
 * due day, stored at UTC midnight, has begun as a real instant. That is 05:00
 * Tashkent on the due day itself, not the day after.
 */
export function toApiTask(reader: Reader, row: TaskRow, now: Date): ApiTask {
  const done = row.completedAt !== null;
  const mayChange = changes(reader, row);
  return {
    id: row.id,
    student: { id: row.student.id, userId: row.student.userId, name: nameOf(row.student.user) },
    program: { id: row.program.id, name: row.program.name, colorIndex: row.program.colorIndex },
    mentor: { id: row.mentor.id, name: nameOf(row.mentor) },
    title: row.title,
    note: row.note,
    due: toDateInputValue(row.dueOn),
    daysLeft: daysAway(row.dueOn, now),
    overdue: !done && row.dueOn.getTime() < now.getTime(),
    percent: row.percent,
    done,
    completedAt: row.completedAt?.toISOString() ?? null,
    can: {
      // `setStudentTaskProgress`: the task's own student, or whoever may change it.
      progress: isStudentOf(reader, row) || mayChange,
      edit: mayChange,
      delete: mayChange,
    },
  };
}

/**
 * One plan item in the contract's shape. `loggedMinutes` is the figure
 * `studentLedger` works out for the website.
 *
 * The note is staff's. The website draws it to nobody else, so the student it
 * is about is never sent it, even one who also administers the program.
 */
export function toApiPlanItem(reader: Reader, row: PlanItemRow, loggedMinutes: number, now: Date): ApiPlanItem {
  const done = row.progress === ASSIGNMENT_PROGRESS.DONE;
  const mayChange = changes(reader, row);
  return {
    id: row.id,
    student: { id: row.student.id, userId: row.student.userId, name: nameOf(row.student.user) },
    program: { id: row.program.id, name: row.program.name, colorIndex: row.program.colorIndex },
    mentor: row.mentor ? { id: row.mentor.id, name: nameOf(row.mentor) } : null,
    purpose: row.purpose,
    minuteLimit: row.minuteLimit,
    loggedMinutes,
    due: row.dueOn ? toDateInputValue(row.dueOn) : null,
    dueNote: row.dueNote,
    note: isStudentOf(reader, row) ? null : row.note,
    // A string column that constants.ts keeps to these three values.
    progress: row.progress as ApiPlanItem["progress"],
    pinned: row.progressManual,
    overdue: !done && row.dueOn !== null && row.dueOn.getTime() < now.getTime(),
    can: { edit: mayChange, progress: mayChange },
  };
}

/** The task as `reader` may see it; null when it doesn't exist or isn't theirs to see. */
export async function taskFor(reader: Reader, id: string, now: Date = new Date()): Promise<ApiTask | null> {
  const row = await prisma.studentTask.findUnique({ where: { id }, include: TASK_INCLUDE });
  // Loaded first and gated second, with one answer for both.
  if (!row || !(await canReadWork(reader, row))) return null;
  return toApiTask(reader, row, now);
}

/** The plan item as `reader` may see it; null when it doesn't exist or isn't theirs to see. */
export async function planItemFor(reader: Reader, id: string, now: Date = new Date()): Promise<ApiPlanItem | null> {
  const row = await prisma.assignment.findUnique({ where: { id }, include: PLAN_ITEM_INCLUDE });
  if (!row || !(await canReadWork(reader, row))) return null;
  const logged = await prisma.session.aggregate({
    where: { assignmentId: id, status: SESSION_STATUS.ACTIVE },
    _sum: { minutes: true },
  });
  return toApiPlanItem(reader, row, logged._sum.minutes ?? 0, now);
}
