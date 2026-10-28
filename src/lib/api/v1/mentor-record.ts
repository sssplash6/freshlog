import "server-only";

import type { ApiMentorRecord, RecordPeriod } from "@/lib/api/v1/types";
import { nameOf } from "@/lib/api/v1/sessions";
import { adminScope, canManageMentor, scopeProgramFilter } from "@/lib/authz";
import { canActAsMentor, ROLES, USER_STATUS } from "@/lib/constants";
import { mentorWindow } from "@/lib/mentor-window";
import { prisma } from "@/lib/prisma";
import { mentorAssignments, mentorOverview } from "@/lib/queries";
import { programToday } from "@/lib/when";
import type { User } from "@/generated/prisma/client";

/** The period as the page's tabs write it: `period=30d`, `period=all`, or none for ninety days. */
export function recordPeriod(raw: string | null): RecordPeriod {
  return raw === "30d" || raw === "all" ? raw : "90d";
}

/**
 * A mentor's record as /mentors/:id's `MentorRecord` reads it, or null for
 * anybody who would get the page's card instead (a student, a colleague) and
 * for no such mentor alike.
 *
 * The page's gate, in its order: the mentor exists and can act as one, then
 * `isSelf || canManageMentor`. Every figure is narrowed to the reader's
 * programs (`scopeProgramFilter(adminScope)`), none for the mentor themselves.
 */
export async function mentorRecordFor(viewer: User, id: string, period: RecordPeriod, now = new Date()): Promise<ApiMentorRecord | null> {
  const mentor = await prisma.user.findUnique({ where: { id } });
  if (!mentor || !canActAsMentor(mentor)) return null;
  const self = viewer.id === mentor.id;
  const manages = viewer.role !== ROLES.STUDENT && (await canManageMentor(viewer, mentor.id));
  if (!self && !manages) return null;

  const programIds = self ? undefined : scopeProgramFilter(await adminScope(viewer));
  const inReach = (programId: string) => !programIds || programIds.includes(programId);
  const win = mentorWindow(period === "90d" ? {} : { period }, now);

  const [allPairings, overview, feedback] = await Promise.all([
    mentorAssignments(mentor.id),
    mentorOverview(mentor.id, { from: win.from, to: win.to }),
    prisma.mentorFeedback.aggregate({
      where: {
        mentorId: mentor.id,
        ...(programIds ? { student: { enrollments: { some: { programId: { in: [...programIds] } } } } } : {}),
      },
      _avg: { rating: true },
      _count: true,
    }),
  ]);

  const pairings = allPairings.filter((a) => inReach(a.programId));
  const byProgram = overview.byProgram.filter((row) => inReach(row.id));
  const students = overview.students
    .filter((s) => inReach(s.program.id))
    .sort((a, b) => (a.deadline?.getTime() ?? 0) - (b.deadline?.getTime() ?? 0));
  const sum = (pick: (row: (typeof byProgram)[number]) => number) => byProgram.reduce((total, row) => total + pick(row), 0);

  return {
    mentor: { id: mentor.id, name: nameOf(mentor), email: mentor.email },
    self,
    period,
    programs: pairings.map((a) => ({
      id: a.program.id,
      name: a.program.name,
      colorIndex: a.program.colorIndex,
      cohort: [a.level?.name, a.cohort?.name].filter(Boolean).join(" / ") || null,
      bookingLink: Boolean(a.calendlyUrl),
    })),
    time: { delivered: sum((r) => r.delivered), missed: sum((r) => r.missed), sessions: sum((r) => r.sessions) },
    students: students.map((s) => ({
      student: { id: s.student.id, userId: s.student.user.id, name: nameOf(s.student.user) },
      program: { id: s.program.id, name: s.program.name, colorIndex: s.program.colorIndex },
      completed: s.completed,
      missed: s.missed,
      remaining: s.remaining,
      forfeited: s.forfeited,
      allocated: s.allocated,
      useBy: s.deadline ? programToday(s.deadline) : null,
      pending: s.student.user.status === USER_STATUS.PENDING,
    })),
    ratings: feedback._count > 0 && feedback._avg.rating != null ? { count: feedback._count, average: feedback._avg.rating } : null,
  };
}
