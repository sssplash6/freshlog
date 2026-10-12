import type { SessionEntry } from "@/components/session-row";
import { SESSION_ANSWER, SESSION_STATUS, chargesAllocation } from "@/lib/constants";
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
    /** With `id` and `colorIndex` when the query selected them, for the dot. */
    program?: { name: string; id?: string; colorIndex?: number } | null;
  } | null;
  assignment?: { id: string; purpose: string } | null;
};

/**
 * `feedback: false` drops the student's rating and note from the entries
 * altogether, for a mentor reading their own sessions. `/feedback` promises a
 * mentor that ratings are anonymous; a row that merely hid them still shipped
 * them to the browser in the page payload, so the promise has to be kept here,
 * on the server, before anything is serialised. The student's yes/no answer
 * stays — it is about whether the meeting happened, not what they thought of
 * it.
 */
export function toSessionEntries(
  sessions: readonly LoggedSession[],
  links: { mentorBase?: string; studentBase?: string; feedback?: boolean } = {},
): SessionEntry[] {
  const feedback = links.feedback ?? true;
  return sessions.map((s) => ({
    id: s.id,
    date: s.date,
    minutes: s.minutes,
    attended: s.attended,
    late: s.late,
    status: s.status,
    withinPlan: s.withinPlan,
    // A note of only spaces is no note: it drew an empty row with a chevron.
    note: s.note?.trim() ? s.note : null,
    studentAnswer: s.studentAnswer ?? null,
    studentRating: feedback ? (s.studentRating ?? null) : null,
    // A DISPUTE's words stay: they are a correction the mentor is told to
    // expect ("<mentor> and your program will see this"), not an opinion.
    studentNote:
      feedback || s.studentAnswer === SESSION_ANSWER.DISPUTED
        ? (s.studentNote ?? null)
        : null,
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
          programRef:
            s.student.program?.id != null && s.student.program.colorIndex != null
              ? {
                  id: s.student.program.id,
                  name: s.student.program.name,
                  colorIndex: s.student.program.colorIndex,
                }
              : null,
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
  return `${active.length} session${active.length === 1 ? "" : "s"} · ${formatDuration(logged)}${
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

/** One line of a student's meetings log: a logged session or a practice interview. */
export type MeetingLogItem<S, I> =
  | { kind: "session"; date: Date; session: S }
  | { kind: "interview"; date: Date; interview: I };

/**
 * Sessions and practice interviews as one history, newest first. Each list
 * keeps its own order within a day; an interview on the same day as a session
 * reads above it, since a session's date is that day's midnight.
 */
export function meetingLog<S extends { date: Date }, I extends { startsAt: Date }>(
  sessions: readonly S[],
  interviews: readonly I[],
): MeetingLogItem<S, I>[] {
  return [
    ...sessions.map((session) => ({ kind: "session" as const, date: session.date, session })),
    ...interviews.map((interview) => ({
      kind: "interview" as const,
      date: interview.startsAt,
      interview,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());
}
