import "server-only";

import type { User } from "@/generated/prisma/client";
import type {
  ClassmateRow,
  InterviewPhase,
  InterviewRow,
  OfferedSlot,
  PersonRef,
  PracticeHome,
  PracticeTodo,
  SlotTime,
} from "@/lib/api/v1/types";
import { ROLES, USER_STATUS } from "@/lib/constants";
import { studiesIn } from "@/lib/enrollments";
import { toDateInputValue } from "@/lib/format";
import { templateName } from "@/lib/interview-templates";
import { MAX_DAYS_AHEAD, SLOT_LENGTHS, guideOpen, interviewPhase, sideOf } from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";
import { PROGRAM_ZONE, programToday, programWallClock } from "@/lib/when";

/**
 * Students practising interviews on each other, as the Practice tab reads it:
 * the reads of `/student/interviews`, field by field, and the To do rows the
 * app shows for them.
 *
 * What a student may see of another is what the page shows: a name and the
 * programs the two share. No email, no Telegram, and a time's meeting link
 * only to its host and to whoever booked it.
 */

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/**
 * How far the program's wall clock is ahead of the real one. `lib/when.ts`
 * keeps the offset to itself; this asks it rather than copying it.
 */
const PROGRAM_OFFSET = programWallClock(new Date(0)).getTime();

/** An approved student and their own enrolments, as the actions' `activeStudent` asks it; or null. */
export async function practiceStudent(user: User) {
  if (user.role !== ROLES.STUDENT || user.status !== USER_STATUS.ACTIVE) return null;
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, enrollments: { select: { programId: true, exchangeId: true } } },
  });
  return profile ? { user, profile } : null;
}

export type PracticeStudent = NonNullable<Awaited<ReturnType<typeof practiceStudent>>>;

/** The words every practice route refuses anybody else with: the actions' own. */
export const NOT_A_STUDENT = "Only approved students can practise interviews.";

const pad = (n: number) => String(n).padStart(2, "0");

/** "15:00", from a wall clock in a UTC field. */
export const wallTime = (wall: Date) => `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;

/**
 * A stored slot as the wire's `SlotTime`: its wall clock read back as the day
 * and time a student typed, and the real instants it starts and ends at.
 */
export function slotTime(slot: { startsAt: Date; minutes: number }): SlotTime {
  const start = slot.startsAt.getTime() - PROGRAM_OFFSET;
  return {
    day: toDateInputValue(slot.startsAt),
    time: wallTime(slot.startsAt),
    minutes: slot.minutes,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + slot.minutes * MINUTE).toISOString(),
  };
}

/**
 * A partner or classmate, by name only. The list of classmates leaves out the
 * unnamed, as the page does; an interview's partner may have lost their name
 * since, and is "A classmate" then, never their email.
 */
export const personOf = (user: { id: string; name: string | null }): PersonRef => ({
  id: user.id,
  name: user.name?.trim() || "A classmate",
});

type HomeInterview = {
  id: string;
  hostId: string;
  guestId: string;
  template: string;
  completedAt: Date | null;
  absentId: string | null;
  slot: { startsAt: Date; minutes: number; meetingUrl: string | null };
  host: { user: { id: string; name: string | null } };
  guest: { user: { id: string; name: string | null } };
  feedback: { submittedAt: Date | null }[];
};

function rowOf(i: HomeInterview, studentId: string, now: Date): InterviewRow {
  const hosting = sideOf(i, studentId) === "host";
  return {
    id: i.id,
    template: { id: i.template, name: templateName(i.template) },
    when: slotTime(i.slot),
    partner: personOf(hosting ? i.guest.user : i.host.user),
    hosting,
    phase: interviewPhase(i, now) satisfies InterviewPhase,
    sent: i.feedback.some((f) => f.submittedAt !== null),
  };
}

/**
 * The practice rows of a student's To do, on freshform's clock:
 * - **join** from a day before the start until the end, while it is open;
 * - **mark** once it has ended and nobody has said how it went;
 * - **feedback** once it is done and this student's is still to send.
 */
export function practiceTodo(interviews: readonly HomeInterview[], studentId: string, now: Date): PracticeTodo[] {
  const wallNow = programWallClock(now).getTime();
  return interviews.flatMap((i): PracticeTodo[] => {
    const start = i.slot.startsAt.getTime();
    const end = start + i.slot.minutes * MINUTE;
    const mine = i.feedback[0]?.submittedAt ?? null;
    const row = rowOf(i, studentId, now);
    const base = { interview: i.id, title: `${row.template.name} · ${row.partner.name}`, when: row.when, meetingUrl: null };
    if (!i.completedAt && !i.absentId) {
      if (start - wallNow <= DAY && wallNow < end) return [{ ...base, need: "join", meetingUrl: i.slot.meetingUrl }];
      if (wallNow >= end) return [{ ...base, need: "mark" }];
      return [];
    }
    if (i.completedAt && guideOpen(i.slot, mine, now, i.absentId)) return [{ ...base, need: "feedback" }];
    return [];
  });
}

/** Everything the Practice tab shows: `app/student/interviews/page.tsx`'s three reads, mapped. */
export async function practiceHomeFor({ profile }: PracticeStudent, now: Date = new Date()): Promise<PracticeHome> {
  const wallNow = programWallClock(now);
  const myPrograms = studiesIn(profile.enrollments).map((e) => e.programId);

  const [interviews, mySlots, classmates] = await Promise.all([
    prisma.peerInterview.findMany({
      where: { OR: [{ hostId: profile.id }, { guestId: profile.id }] },
      select: {
        id: true,
        hostId: true,
        guestId: true,
        template: true,
        completedAt: true,
        absentId: true,
        slot: { select: { startsAt: true, minutes: true, meetingUrl: true } },
        host: { select: { user: { select: { id: true, name: true } } } },
        guest: { select: { user: { select: { id: true, name: true } } } },
        // Only this student's own row, and only whether it was sent.
        feedback: { where: { fromId: profile.id }, select: { submittedAt: true } },
      },
      orderBy: { slot: { startsAt: "asc" } },
    }),
    prisma.interviewSlot.findMany({
      where: { studentId: profile.id, startsAt: { gt: wallNow } },
      select: {
        id: true,
        startsAt: true,
        minutes: true,
        meetingUrl: true,
        interview: { select: { id: true, guest: { select: { user: { select: { id: true, name: true } } } } } },
      },
      orderBy: { startsAt: "asc" },
    }),
    myPrograms.length === 0
      ? Promise.resolve([])
      : prisma.studentProfile.findMany({
          where: {
            id: { not: profile.id },
            user: { role: ROLES.STUDENT, status: USER_STATUS.ACTIVE, name: { not: null } },
            enrollments: { some: { programId: { in: myPrograms }, exchangeId: null } },
          },
          select: {
            id: true,
            user: { select: { id: true, name: true } },
            enrollments: {
              where: { programId: { in: myPrograms }, exchangeId: null },
              select: { program: { select: { name: true } } },
            },
            interviewSlots: {
              where: { startsAt: { gt: wallNow }, interview: null },
              select: { startsAt: true, minutes: true },
              orderBy: { startsAt: "asc" },
            },
          },
        }),
  ]);

  const rows = interviews.map((i) => rowOf(i, profile.id, now));
  const coming = rows.filter((r) => r.phase === "booked" || r.phase === "to-mark");
  const done = rows.filter((r) => r.phase === "completed" || r.phase === "absent").reverse();

  const times = mySlots.map(
    (s): OfferedSlot => ({
      id: s.id,
      when: slotTime(s),
      meetingUrl: s.meetingUrl,
      interview: s.interview && { id: s.interview.id, guest: personOf(s.interview.guest.user) },
    })
  );

  const showPrograms = myPrograms.length > 1;
  const named = classmates.filter((c) => c.user.name?.trim());
  const byName = (a: (typeof named)[number], b: (typeof named)[number]) =>
    (a.user.name ?? "").localeCompare(b.user.name ?? "");
  const offering = named.filter((c) => c.interviewSlots.length > 0).sort(byName);
  const quiet = named.filter((c) => c.interviewSlots.length === 0).sort(byName);
  const classmateRows = [...offering, ...quiet].map(
    (c): ClassmateRow => ({
      id: c.id,
      person: personOf(c.user),
      programs: showPrograms ? c.enrollments.map((e) => e.program.name) : [],
      open: c.interviewSlots.length,
      next: c.interviewSlots[0] ? slotTime(c.interviewSlots[0]) : null,
    })
  );

  return {
    coming,
    done,
    times,
    classmates: classmateRows,
    todo: practiceTodo(interviews, profile.id, now),
    offer: {
      today: programToday(now),
      lastDay: toDateInputValue(new Date(wallNow.getTime() + MAX_DAYS_AHEAD * DAY)),
      lengths: [...SLOT_LENGTHS],
    },
    zone: PROGRAM_ZONE,
  };
}
