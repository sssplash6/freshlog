import type { SessionEntry } from "@/components/session-row";

export type LoggedSession = {
  id: string;
  minutes: number;
  date: Date;
  attended: boolean;
  late: boolean;
  note: string | null;
  status: string;
  withinPlan: boolean;
  studentAnswer?: string | null;
  studentRating?: number | null;
  studentNote?: string | null;
  mentor: { id: string; name: string | null; email: string; avatarUpdatedAt?: Date | null };
  student?: {
    id: string;
    user: { name: string | null; email: string; avatarUpdatedAt?: Date | null };
    program?: { name: string } | null;
  } | null;
  assignment?: { id: string; purpose: string } | null;
};

export function toSessionEntries(
  sessions: readonly LoggedSession[],
  links: { mentorBase?: string; studentBase?: string } = {},
): SessionEntry[] {
  return sessions.map((s) => ({
    id: s.id,
    date: s.date,
    minutes: s.minutes,
    attended: s.attended,
    late: s.late,
    status: s.status,
    withinPlan: s.withinPlan,
    note: s.note,
    studentAnswer: s.studentAnswer ?? null,
    studentRating: s.studentRating ?? null,
    studentNote: s.studentNote ?? null,
    mentor: {
      id: s.mentor.id,
      name: s.mentor.name,
      email: s.mentor.email,
      avatarUpdatedAt: s.mentor.avatarUpdatedAt,
      href: links.mentorBase ? `${links.mentorBase}/${s.mentor.id}` : undefined,
    },
    student: s.student
      ? {
          id: s.student.id,
          name: s.student.user.name,
          email: s.student.user.email,
          avatarUpdatedAt: s.student.user.avatarUpdatedAt,
          program: s.student.program?.name ?? null,
          href: links.studentBase ? `${links.studentBase}/${s.student.id}` : undefined,
        }
      : null,
    task: s.assignment ?? null,
  }));
}
