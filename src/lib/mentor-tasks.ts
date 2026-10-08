import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Tasks a program's admin sets its MENTORS — the third thing this app calls a
 * task, and the only one whose doer is staff.
 *
 *   agenda        `Assignment`. Hours a mentor delivers to a student.
 *   student task  `StudentTask`. Work a mentor sets a student.
 *   mentor task   `MentorTask`. Work an admin sets mentors. This file.
 *
 * One task reaches one mentor, several, or the whole team at once, and may be
 * about none, one or several of the program's students. Each mentor finishes
 * their own share; the task is done when every share is.
 */

export const MAX_MENTOR_TASK_TITLE = 120;
export const MAX_MENTOR_TASK_NOTE = 500;

/**
 * The program's team: everyone paired to teach in it, once each.
 *
 * A pairing is what puts a mentor in a program — the same rows Settings lists
 * — so a mentor paired to two cohorts here is one person on the list, and a
 * mentor who only ever held hours here through an exchange is not on it.
 */
export async function programTeam(programId: string) {
  const pairings = await prisma.mentorAssignment.findMany({
    where: { programId },
    select: {
      mentor: {
        select: { id: true, name: true, email: true, avatarUpdatedAt: true },
      },
    },
  });
  const team = new Map(pairings.map((p) => [p.mentor.id, p.mentor]));
  return [...team.values()].sort((a, b) =>
    (a.name ?? a.email).localeCompare(b.name ?? b.email)
  );
}

/** Every task set in one program, soonest deadline first, with who and about whom. */
export function programMentorTasks(programId: string) {
  return prisma.mentorTask.findMany({
    where: { programId },
    orderBy: [{ dueOn: "asc" }, { createdAt: "asc" }],
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      assignees: {
        include: {
          mentor: {
            select: { id: true, name: true, email: true, avatarUpdatedAt: true },
          },
        },
      },
      students: {
        include: {
          student: {
            select: {
              id: true,
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      },
    },
  });
}

/**
 * One mentor's own shares, across every program that set them one.
 *
 * Open ones first, then what they finished in the last fortnight — long enough
 * to undo a tap made by mistake, short enough that the list stays a to-do list.
 */
export function mentorOwnTasks(mentorId: string, now: Date) {
  const recent = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  return prisma.mentorTaskAssignee.findMany({
    where: {
      mentorId,
      OR: [{ completedAt: null }, { completedAt: { gte: recent } }],
    },
    orderBy: [{ task: { dueOn: "asc" } }],
    include: {
      task: {
        include: {
          program: { select: { id: true, name: true, colorIndex: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          students: {
            include: {
              student: {
                select: {
                  id: true,
                  user: { select: { id: true, name: true, email: true } },
                },
              },
            },
          },
        },
      },
    },
  });
}
