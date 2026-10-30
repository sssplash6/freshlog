import "server-only";

import type { User } from "@/generated/prisma/client";
import { mentorReaches } from "@/lib/authz";
import { canActAsMentor, SESSION_STATUS } from "@/lib/constants";
import {
  accessToken,
  googleConfigured,
  GoogleError,
  listAttendance,
  listConferences,
  listEvents,
  MEETING_CODE,
  openToken,
  type CalendarEvent,
} from "@/lib/google";
import { localDay, measureMeeting, type DraftStudent, type MeetParticipant } from "@/lib/meet-drafts";
import { prisma } from "@/lib/prisma";

/**
 * Turn the Google Meet calls each connected mentor held into drafts.
 *
 * Run every ten minutes by the Render cron (render.yaml), through
 * /api/cron/meet-sync. It writes drafts and nothing else: no Session, no
 * balance, no notification. A draft becomes a session only when the mentor
 * saves the ordinary log form it pre-fills.
 *
 * IDEMPOTENT BY CONSTRUCTION. It looks back two days on every run instead of
 * remembering where it stopped, and a draft is unique on (mentor, event,
 * student) — so a run that fails half way, or two that overlap, write nothing
 * twice and miss nothing. Two days because a call is not measurable until it
 * has ended, and a mentor whose token failed over a weekend should still get
 * Friday's meetings once they reconnect.
 */

const LOOK_BACK_MS = 2 * 24 * 60 * 60 * 1000;
/** A call can open a little before its booked start; this still finds it. */
const EARLY_JOIN_MS = 30 * 60 * 1000;

export type SyncResult = {
  configured: boolean;
  mentors: number;
  drafts: number;
  failed: number;
};

export async function syncMeetDrafts(now = new Date()): Promise<SyncResult> {
  if (!googleConfigured()) return { configured: false, mentors: 0, drafts: 0, failed: 0 };

  const connections = await prisma.googleConnection.findMany({
    where: { failedAt: null },
    include: { user: true },
  });

  let drafts = 0;
  let failed = 0;
  let mentors = 0;
  for (const connection of connections) {
    // A mentor who has since lost the role keeps the row (they may get it
    // back) but is not read on anybody's behalf in the meantime.
    if (!canActAsMentor(connection.user)) continue;
    mentors++;
    try {
      const token = await accessToken(openToken(connection.refreshToken));
      drafts += await syncMentor(connection.user, token, now);
      await prisma.googleConnection.update({
        where: { userId: connection.userId },
        data: { lastSyncAt: now, lastError: null },
      });
    } catch (error) {
      failed++;
      const revoked = error instanceof GoogleError && error.reason === "revoked";
      // Only a refused grant stops the sync for this mentor. A timeout or a
      // 500 is Google's bad minute, and the next run retries it.
      await prisma.googleConnection.update({
        where: { userId: connection.userId },
        data: {
          lastSyncAt: now,
          lastError: error instanceof Error ? error.message.slice(0, 500) : "unknown",
          ...(revoked ? { failedAt: now } : {}),
        },
      });
      console.error(`[meet-sync] ${connection.user.email}:`, error);
    }
  }
  return { configured: true, mentors, drafts, failed };
}

/** One mentor's last two days. Returns how many drafts were written. */
async function syncMentor(mentor: User, token: string, now: Date): Promise<number> {
  const events = await listEvents(token, new Date(now.getTime() - LOOK_BACK_MS), now);
  let written = 0;

  for (const event of events) {
    const meeting = meetingOf(event, now);
    if (!meeting) continue;

    const students = await invitedStudents(mentor, event);
    if (students.length === 0) continue;

    // Skip whoever already has a draft from this event, or a session with
    // this mentor that day: a mentor who logged by hand before the sync
    // reached the meeting must not then be asked to log it again. A voided
    // session logged nothing, so it does not count as that log.
    const [drafted, logged] = await Promise.all([
      prisma.meetDraft.findMany({
        where: { mentorId: mentor.id, eventId: event.id },
        select: { studentId: true },
      }),
      prisma.session.findMany({
        where: {
          mentorId: mentor.id,
          date: meeting.date,
          studentId: { in: students.map((s) => s.profileId) },
          status: { not: SESSION_STATUS.VOIDED },
        },
        select: { studentId: true },
      }),
    ]);
    const done = new Set([...drafted, ...logged].map((r) => r.studentId));
    const open = students.filter((s) => !done.has(s.profileId));
    if (open.length === 0) continue;

    const conferences = await listConferences(
      token,
      meeting.code,
      new Date(meeting.start.getTime() - EARLY_JOIN_MS),
      meeting.end
    );
    // Nobody opened the call — or it was opened from an account this mentor
    // does not own. Either way there is nothing measured to suggest.
    if (conferences.length === 0) continue;
    // Still running: measure it on a later run, once everybody has left.
    if (conferences.some((c) => !c.endTime)) continue;

    const participants = mergeByUser(
      (await Promise.all(conferences.map((c) => listAttendance(token, c)))).flat()
    );
    const starts = conferences.map((c) => new Date(c.startTime).getTime());
    const ends = conferences.map((c) => new Date(c.endTime!).getTime());

    const measured = measureMeeting({
      bookedStart: meeting.start,
      mentorGoogleId: mentor.googleId,
      conference: { start: new Date(Math.min(...starts)), end: new Date(Math.max(...ends)) },
      participants,
      students: open,
    });

    for (const m of measured) {
      try {
        await prisma.meetDraft.create({
          data: {
            mentorId: mentor.id,
            studentId: m.profileId,
            programId: await onlyProgram(mentor.id, m.profileId),
            eventId: event.id,
            startsAt: meeting.start,
            date: meeting.date,
            minutes: m.minutes,
            attendance: m.attendance,
          },
        });
        written++;
      } catch (error) {
        // A concurrent run wrote it first; the unique key did its job.
        if ((error as { code?: string }).code !== "P2002") throw error;
      }
    }
  }
  return written;
}

/** The parts of an event that make it a finished Meet call, or null. */
function meetingOf(event: CalendarEvent, now: Date) {
  if (event.status === "cancelled") return null;
  if (event.conferenceData?.conferenceSolution?.key?.type !== "hangoutsMeet") return null;
  const code = event.conferenceData.conferenceId;
  const startText = event.start?.dateTime;
  const endText = event.end?.dateTime;
  // All-day events have a date and no time; nobody holds a lesson that way.
  if (!code || !startText || !endText) return null;
  // Never reaches the filter unless it is the shape Google issues: the
  // event's organiser, who may be anybody, writes this field.
  if (!MEETING_CODE.test(code)) return null;
  const start = new Date(startText);
  const end = new Date(endText);
  const date = localDay(startText);
  if (!date || Number.isNaN(start.getTime()) || end > now) return null;
  return { code, start, end, date };
}

/**
 * The event's guests who are students this mentor may log for — the same
 * question the log form asks, so a draft never offers a student the form
 * would then refuse.
 */
async function invitedStudents(mentor: User, event: CalendarEvent): Promise<DraftStudent[]> {
  const emails = (event.attendees ?? [])
    .filter((a) => !a.self && !a.resource && a.email)
    .map((a) => a.email!.toLowerCase());
  if (emails.length === 0) return [];
  const profiles = await prisma.studentProfile.findMany({
    where: { user: { email: { in: emails } } },
    select: { id: true, user: { select: { googleId: true } } },
  });
  const reached: DraftStudent[] = [];
  for (const p of profiles) {
    if (await mentorReaches(mentor, p)) {
      reached.push({ profileId: p.id, googleId: p.user.googleId });
    }
  }
  return reached;
}

/** One row per person across a call that was ended and reopened. */
function mergeByUser(rows: MeetParticipant[]): MeetParticipant[] {
  const byUser = new Map<string, MeetParticipant>();
  const anonymous: MeetParticipant[] = [];
  for (const row of rows) {
    if (!row.user) {
      anonymous.push(row);
      continue;
    }
    const seen = byUser.get(row.user);
    if (seen) seen.sessions.push(...row.sessions);
    else byUser.set(row.user, { user: row.user, sessions: [...row.sessions] });
  }
  return [...byUser.values(), ...anonymous];
}

/**
 * The program, when only one can be meant: this mentor holds time with this
 * student in exactly one. Two or none and the mentor picks on the form —
 * guessing would spend one program's hours out of another program's grant.
 */
async function onlyProgram(mentorId: string, studentId: string): Promise<string | null> {
  const grants = await prisma.hourAllocation.findMany({
    where: { mentorId, studentId },
    select: { programId: true },
    distinct: ["programId"],
  });
  return grants.length === 1 ? grants[0].programId : null;
}
