import { ATTENDANCE } from "@/lib/constants";

/**
 * What a Google Meet call says about one meeting, as a session the mentor can
 * log: how long the mentor and the student were in it together, and whether
 * the student came, came late, or did not come.
 *
 * Pure, so every edge — a rejoin, a dropped connection, a student who never
 * turned up, a call that ran past midnight — is a unit test and not a guess
 * about what Google sent.
 *
 * MEASURED, NOT BOOKED. The calendar says how long the meeting was booked
 * for; Meet says how long it happened. A session's minutes draw down the
 * student's hours, so a 60-minute booking that ended after 35 would charge
 * 25 minutes nobody delivered. Every figure here comes from the join and leave
 * times.
 */

/** A student is late once they join this long after the booked start. */
export const LATE_AFTER_MINUTES = 10;
/** Minutes are suggested to the nearest five; the mentor can type any figure. */
export const ROUND_TO_MINUTES = 5;

export type Interval = { start: Date; end: Date };

/** One person in the call, as Meet reports them. */
export type MeetParticipant = {
  /** `users/<id>` for a signed-in Google account; null for a guest or a phone. */
  user: string | null;
  sessions: Interval[];
};

export type DraftStudent = {
  profileId: string;
  /** Their Google account id, once they have signed in since it was recorded. */
  googleId: string | null;
};

export type Measured = {
  profileId: string;
  minutes: number;
  /** ATTENDED | LATE | ABSENT, or null when the call cannot say. */
  attendance: string | null;
};

/** Overlapping intervals folded into a sorted, disjoint list. */
export function union(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) {
      if (i.end > last.end) last.end = i.end;
    } else {
      out.push({ start: i.start, end: i.end });
    }
  }
  return out;
}

/** Milliseconds two people were both present. */
export function overlapMs(a: Interval[], b: Interval[]): number {
  const x = union(a);
  const y = union(b);
  let total = 0;
  for (const i of x) {
    for (const j of y) {
      const start = Math.max(i.start.getTime(), j.start.getTime());
      const end = Math.min(i.end.getTime(), j.end.getTime());
      if (end > start) total += end - start;
    }
  }
  return total;
}

const totalMs = (intervals: Interval[]) =>
  union(intervals).reduce((sum, i) => sum + (i.end.getTime() - i.start.getTime()), 0);

/**
 * To the nearest five minutes, and never under five: a draft that says
 * "0 min" is a meeting the mentor would have to retype, and the log form
 * refuses zero anyway.
 */
export function roundMinutes(ms: number): number {
  const minutes = ms / 60_000;
  return Math.max(ROUND_TO_MINUTES, Math.round(minutes / ROUND_TO_MINUTES) * ROUND_TO_MINUTES);
}

/**
 * Measure one call for each student invited to it.
 *
 * Who is who: Meet names a signed-in participant `users/<id>`, never by email,
 * and that id is the Google account id Freshlog records when somebody signs
 * in. A student who has not signed in since then has no id yet; for them the
 * one fallback is a call with exactly one invited student and exactly one
 * person in it besides the mentor — that person can only be the student.
 * Anything less certain leaves attendance blank for the mentor to answer.
 */
export function measureMeeting({
  bookedStart,
  mentorGoogleId,
  conference,
  participants,
  students,
}: {
  bookedStart: Date;
  mentorGoogleId: string | null;
  /** The call as a whole, when the mentor cannot be picked out of it. */
  conference: Interval;
  participants: MeetParticipant[];
  students: DraftStudent[];
}): Measured[] {
  const mentorKey = mentorGoogleId ? `users/${mentorGoogleId}` : null;
  const mentorRow = mentorKey ? participants.find((p) => p.user === mentorKey) : undefined;
  // Not found means the mentor's id is not recorded yet, or they joined from
  // another account. The call ran while somebody hosted it; that is the best
  // available stand-in for the mentor's own time.
  const mentorTime = mentorRow ? mentorRow.sessions : [conference];
  const others = participants.filter((p) => p !== mentorRow && !(mentorKey && p.user === mentorKey));

  const known = new Set(
    students.flatMap((s) => (s.googleId ? [`users/${s.googleId}`] : []))
  );
  // People in the call nobody can name: guests, phones, and signed-in
  // accounts that are not one of this call's students.
  const unnamed = others.filter((p) => !p.user || !known.has(p.user));

  return students.map((student) => {
    const key = student.googleId ? `users/${student.googleId}` : null;
    let row = key ? others.find((p) => p.user === key) : undefined;
    if (!row && !key && students.length === 1 && others.length === 1) row = others[0];

    if (row) {
      const together = overlapMs(mentorTime, row.sessions);
      const firstJoin = Math.min(...row.sessions.map((s) => s.start.getTime()));
      const late = firstJoin > bookedStart.getTime() + LATE_AFTER_MINUTES * 60_000;
      return {
        profileId: student.profileId,
        minutes: roundMinutes(together),
        attendance: late ? ATTENDANCE.LATE : ATTENDANCE.ATTENDED,
      };
    }

    // Not in the call — as far as anybody can tell. Absent is only said when
    // it is certain: the student is identifiable and nobody unnamed was there
    // who could have been them. The minutes are the mentor's own time in the
    // call, which is the time a no-show is charged for.
    const certain = key !== null || unnamed.length === 0;
    return {
      profileId: student.profileId,
      minutes: roundMinutes(totalMs(mentorTime)),
      attendance: certain ? ATTENDANCE.ABSENT : null,
    };
  });
}

/**
 * The day a meeting falls on, in the calendar's own time zone, as the UTC
 * midnight `Session.date` is stored as. Google writes an event's start as
 * local time with its offset — "2026-10-13T23:30:00+05:00" — so the first ten
 * characters ARE the local date; converting to UTC first would put a late
 * evening meeting in Tashkent on the wrong day.
 */
export function localDay(dateTime: string): Date | null {
  const day = dateTime.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
