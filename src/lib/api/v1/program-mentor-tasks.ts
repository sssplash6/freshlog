import "server-only";

import { nameOf } from "@/lib/api/v1/sessions";
import { isText } from "@/lib/api/v1/session-forms";
import type { MentorTaskCreate, ProgramMentorTask, ProgramMentorTasks } from "@/lib/api/v1/types";
import { isDay } from "@/lib/api/v1/work-forms";
import { USER_STATUS } from "@/lib/constants";
import { toDateInputValue } from "@/lib/format";
import { MAX_MENTOR_TASK_NOTE, MAX_MENTOR_TASK_TITLE, programMentorTasks, programTeam } from "@/lib/mentor-tasks";
import { prisma } from "@/lib/prisma";
import { daysAway, programToday } from "@/lib/when";

/**
 * The tasks a program's admins give its mentors, from the admin's side, for the
 * freshlog app: the website's `/programs/[id]/tasks`, read with the same
 * functions (`programMentorTasks`, `programTeam`).
 */

type TaskRow = Awaited<ReturnType<typeof programMentorTasks>>[number];

/**
 * One task. `overdue` is `MentorTaskDue`'s rule: late from the day after its
 * due day, and never once everyone is done.
 */
function toProgramMentorTask(row: TaskRow, now: Date): ProgramMentorTask {
  const done = row.assignees.length > 0 && row.assignees.every((a) => a.completedAt !== null);
  const daysLeft = daysAway(row.dueOn, now);
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    due: toDateInputValue(row.dueOn),
    daysLeft,
    overdue: !done && daysLeft < 0,
    createdBy: { id: row.createdBy.id, name: nameOf(row.createdBy) },
    assignees: row.assignees.map((a) => ({ shareId: a.id, mentor: { id: a.mentor.id, name: nameOf(a.mentor) }, done: a.completedAt !== null })),
    about: row.students.map(({ student }) => ({ id: student.id, userId: student.user.id, name: nameOf(student.user) })),
    done,
  };
}

/** The program's students a task may be about: everyone enrolled whose account is active, by name. */
async function programStudentRefs(programId: string) {
  const rows = await prisma.studentEnrollment.findMany({
    where: { programId, student: { user: { status: USER_STATUS.ACTIVE } } },
    select: { student: { select: { id: true, userId: true, user: { select: { name: true, email: true } } } } },
  });
  return rows
    .map(({ student }) => ({ id: student.id, userId: student.userId, name: nameOf(student.user) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The program's tasks for mentors, open first by due day and then done, with who they may go to and be about. */
export async function programMentorTasksFor(programId: string, write: boolean, now: Date = new Date()): Promise<ProgramMentorTasks> {
  const [rows, team, students] = await Promise.all([programMentorTasks(programId), programTeam(programId), programStudentRefs(programId)]);
  // `programMentorTasks` is already by due day, then made first; open ones lead.
  const items = rows.map((row) => toProgramMentorTask(row, now));
  return {
    items: [...items.filter((t) => !t.done), ...items.filter((t) => t.done)],
    team: team.map((m) => ({ id: m.id, name: nameOf(m) })),
    students,
    can: { write },
    today: programToday(now),
  };
}

/**
 * `setMentorTask`'s FormData, or the first field that the action would refuse
 * without naming. Every mentor must be on the program's team and every student
 * in the program, which the action asks too, in one sentence for the lot.
 */
export async function mentorTaskForm(programId: string, body: Record<string, unknown>): Promise<FormData | { field: string }> {
  const { title, due, note, mentors, about } = body as Partial<Record<keyof MentorTaskCreate, unknown>>;
  const collapsed = isText(title) ? title.trim().replace(/\s+/g, " ") : "";
  if (!collapsed || collapsed.length > MAX_MENTOR_TASK_TITLE) return { field: "title" };
  if (!isDay(due)) return { field: "due" };
  if (note !== undefined && (!isText(note) || note.trim().length > MAX_MENTOR_TASK_NOTE)) return { field: "note" };
  const ids = (value: unknown) => (Array.isArray(value) && value.every(isText) ? [...new Set(value)] : null);
  const mentorIds = ids(mentors);
  const studentIds = about === undefined ? [] : ids(about);
  if (!mentorIds || mentorIds.length === 0) return { field: "mentors" };
  if (!studentIds) return { field: "about" };
  const [team, students] = await Promise.all([programTeam(programId), programStudentRefs(programId)]);
  const onTeam = new Set(team.map((m) => m.id));
  const enrolled = new Set(students.map((s) => s.id));
  if (!mentorIds.every((id) => onTeam.has(id))) return { field: "mentors" };
  if (!studentIds.every((id) => enrolled.has(id))) return { field: "about" };

  const form = new FormData();
  form.set("programId", programId);
  form.set("title", collapsed);
  form.set("dueOn", due);
  form.set("note", isText(note) ? note : "");
  for (const id of mentorIds) form.append("mentorIds", id);
  for (const id of studentIds) form.append("studentIds", id);
  return form;
}
