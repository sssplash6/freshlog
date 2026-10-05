import type { SessionEntry } from "@/components/session-row";
import { SESSION_STATUS, chargesAllocation } from "@/lib/constants";
import { formatDuration } from "@/lib/format";

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
    // The USER's id, for the face: identity colour and picture are keyed by
    // the person, and the profile id gave one student two colours.
    user: { id: string; name: string | null; email: string; avatarUpdatedAt?: Date | null };
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
          id: s.student.user.id,
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

/**
 * What a log of these adds up to, for the caption above it.
 *
 * Voided and rescheduled rows are history, not hours, and out-of-plan time is
 * named beside the total rather than folded into it — a caption that added
 * them together would disagree with the balance on the same page.
 *
 * It lives here rather than beside the row it captions for the same reason
 * `toSessionEntries` does: `session-row.tsx` is a client module, and a plain
 * function exported from one is a client REFERENCE to a server component that
 * imports it, not the function. Calling it throws, and the page that did —
 * `/mentors/[id]` — rendered its error boundary instead of a mentor.
 */
export function sessionsCaption(sessions: readonly SessionEntry[]): string {
  const active = sessions.filter((s) => s.status === SESSION_STATUS.ACTIVE);
  if (active.length === 0) return "Nothing logged yet";
  const logged = active
    .filter(chargesAllocation)
    .reduce((sum, s) => sum + s.minutes, 0);
  const extra = active
    .filter((s) => !s.withinPlan)
    .reduce((sum, s) => sum + s.minutes, 0);
  return `${active.length} meeting${active.length === 1 ? "" : "s"} · ${formatDuration(logged)}${
    extra > 0 ? ` · ${formatDuration(extra)} extra` : ""
  }`;
}

/**
 * How many MEETINGS a list holds: the ones that actually happened. A voided or
 * rescheduled row is a line in the history, not a meeting, so it is not
 * counted. One definition, so the student's home, the meetings page's caption
 * and its footer cannot give three numbers for the same five rows.
 */
export function meetingCount(sessions: readonly { status: string }[]): number {
  return sessions.filter((s) => s.status === SESSION_STATUS.ACTIVE).length;
}

/** What the rows that are not meetings were, for a footer: "1 voided". */
export function notHeldNote(sessions: readonly { status: string }[]): string | undefined {
  const voided = sessions.filter((s) => s.status === SESSION_STATUS.VOIDED).length;
  const moved = sessions.filter((s) => s.status === SESSION_STATUS.RESCHEDULED).length;
  const parts = [
    voided > 0 ? `${voided} voided` : null,
    moved > 0 ? `${moved} rescheduled` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
