import "server-only";

import type { Prisma, User } from "@/generated/prisma/client";
import { mentorHasWorkedWith } from "@/lib/authz";
import { canActAsMentor, ROLES, USER_STATUS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { mentorReachWhere } from "@/lib/queries";

/**
 * Who may practise an interview with whom.
 *
 * Two students: any two approved students, whatever their programs. A mentor
 * and a student: only one the mentor has worked with — a grant, a session or a
 * task between them, the same reach that lets a mentor read the student's
 * interviews (`mentorHasWorkedWith`). Two mentors: never; the feature is for
 * students to rehearse.
 *
 * A person takes part in a CAPACITY. A student-who-mentors is one user, and
 * offers a time either as a student, for classmates, or as a mentor, for their
 * students; the slot remembers which (`InterviewSlot.asMentor`).
 */
export type Capacity = "student" | "mentor";

type Person = Pick<User, "id" | "role" | "status" | "isMentor" | "name">;

/** Whether this user may take part in this capacity at all. */
export function actsAs(user: Person, as: Capacity): boolean {
  if (as === "student") return user.role === ROLES.STUDENT && user.status === USER_STATUS.ACTIVE;
  return canActAsMentor(user) && user.status !== USER_STATUS.PENDING && !!user.name?.trim();
}

/** The capacity a form asked for: "mentor" only when it says so. */
export function capacityFrom(raw: FormDataEntryValue | null): Capacity {
  return raw === "mentor" ? "mentor" : "student";
}

async function hasWorkedWith(mentor: Person, studentUserId: string): Promise<boolean> {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: studentUserId },
    select: { id: true },
  });
  return profile !== null && mentorHasWorkedWith(mentor as User, profile);
}

/**
 * Whether `me`, acting `as`, may book this time. The owner must still qualify
 * in the capacity they offered it in — a student who has left, or a mentor no
 * longer one, offers nothing.
 */
export async function mayBook(
  me: Person,
  as: Capacity,
  slot: { asMentor: boolean; user: Person }
): Promise<boolean> {
  if (slot.user.id === me.id || !actsAs(me, as)) return false;
  const owner: Capacity = slot.asMentor ? "mentor" : "student";
  if (!actsAs(slot.user, owner)) return false;
  if (owner === "student" && as === "student") return true;
  if (owner === "mentor" && as === "student") return hasWorkedWith(slot.user, me.id);
  if (owner === "student" && as === "mentor") return hasWorkedWith(me, slot.user.id);
  return false;
}

/** The open times still ahead, of one capacity. */
const openTimes = (asMentor: boolean, wallNow: Date) =>
  ({
    where: { asMentor, startsAt: { gt: wallNow }, interview: null },
    select: { id: true, startsAt: true, minutes: true },
    orderBy: { startsAt: "asc" },
  }) satisfies Prisma.User$interviewSlotsArgs;

/**
 * The mentors a student may book: everyone who has held a grant, a session or
 * a task with them, as `mentorReachWhere` asks it from the mentor's side.
 */
export async function mentorsOfStudent(studentUserId: string, wallNow: Date) {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: studentUserId },
    select: { id: true },
  });
  if (!profile) return [];
  const studentId = profile.id;
  const rows = await prisma.user.findMany({
    where: {
      id: { not: studentUserId },
      name: { not: null },
      status: { not: USER_STATUS.PENDING },
      OR: [
        { hourAllocations: { some: { studentId } } },
        { mentorSessions: { some: { studentId } } },
        { assignments: { some: { studentId } } },
      ],
    },
    select: {
      id: true,
      name: true,
      role: true,
      status: true,
      isMentor: true,
      avatarUpdatedAt: true,
      interviewSlots: openTimes(true, wallNow),
    },
    orderBy: { name: "asc" },
  });
  return rows.filter((m) => actsAs(m, "mentor"));
}

/** The students a mentor may book: the ones they have worked with. */
export async function studentsOfMentor(mentorId: string, wallNow: Date) {
  return prisma.user.findMany({
    where: {
      id: { not: mentorId },
      role: ROLES.STUDENT,
      status: USER_STATUS.ACTIVE,
      name: { not: null },
      studentProfile: mentorReachWhere(mentorId),
    },
    select: {
      id: true,
      name: true,
      avatarUpdatedAt: true,
      studentProfile: {
        select: {
          enrollments: { where: { exchangeId: null }, select: { program: { select: { name: true } } } },
        },
      },
      interviewSlots: openTimes(false, wallNow),
    },
    orderBy: { name: "asc" },
  });
}
