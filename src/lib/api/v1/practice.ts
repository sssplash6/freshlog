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
import { toDateInputValue } from "@/lib/format";
import { actsAs, type Capacity } from "@/lib/interview-partners";
import { templateName } from "@/lib/interview-templates";
import type { InterviewViewer } from "@/lib/interview-viewer";
import {
  SLOT_LENGTHS,
  givesFeedback,
  guideOpen,
  interviewPhase,
  partOf,
  sideOf,
} from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";
import { interviewsHomeData, type Partner } from "@/lib/screens/interviews";
import { PROGRAM_ZONE, programWallClock } from "@/lib/when";

/**
 * Practising interviews, as the app's Practice (a student's) and Interviews (a
 * mentor's) read it: the reads of `/student/interviews` and
 * `/mentor/interviews`, field by field, and a student's To do rows for them.
 *
 * What a student may see of another is what the page shows: a name and their
 * own programs. No email, no Telegram, and a time's meeting link
 * only to its host and to whoever booked it.
 */

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/**
 * How far the program's wall clock is ahead of the real one. `lib/when.ts`
 * keeps the offset to itself; this asks it rather than copying it.
 */
const PROGRAM_OFFSET = programWallClock(new Date(0)).getTime();

/**
 * Who practises in `as`, as the website's interview pages ask it
 * (`requireInterviewViewer`): an approved student, or a named mentor who isn't
 * pending (`actsAs`). Null for anybody else.
 */
export function practiceViewer(user: User, as: Capacity, now: Date = new Date()): InterviewViewer | null {
  if (!actsAs(user, as)) return null;
  return { user, as, base: as === "mentor" ? "/mentor/interviews" : "/student/interviews", now };
}

/** The capacity a request names (`?as=` or a body's `as`): a mentor's only when it says so, as the actions read it. */
export const capacityOf = (raw: unknown): Capacity => (raw === "mentor" ? "mentor" : "student");

/** The reader in whichever capacity they can practise in: a student's first, as `actsAs` asks it. For a write about one interview. */
export const anyPracticeViewer = (user: User) => practiceViewer(user, "student") ?? practiceViewer(user, "mentor");

/** The words every practice route refuses anybody else with: the actions' own. */
export const NOT_A_STUDENT = "Only approved students and their mentors can practise interviews.";

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
  mentorId: string | null;
  absentId: string | null;
  slot: { startsAt: Date; minutes: number; meetingUrl: string | null };
  host: { id: string; name: string | null };
  guest: { id: string; name: string | null };
  feedback: { submittedAt: Date | null }[];
};

function rowOf(i: HomeInterview, userId: string, now: Date): InterviewRow {
  const hosting = sideOf(i, userId) === "host";
  return {
    id: i.id,
    template: { id: i.template, name: templateName(i.template) },
    when: slotTime(i.slot),
    partner: personOf(hosting ? i.guest : i.host),
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
    // The student a mentor interviews has no feedback to send.
    if (i.completedAt && givesFeedback(partOf(i, studentId)) && guideOpen(i.slot, mine, now, i.absentId)) {
      return [{ ...base, need: "feedback" }];
    }
    return [];
  });
}

/** A partner as the home lists them, by the name the page shows. */
const partnerRow = (p: Partner): ClassmateRow => ({ id: p.id, person: personOf(p), programs: p.programs, open: p.open });

/**
 * Everything the Interviews home shows, in the reader's capacity: the page's
 * own reads (`interviewsHomeData`) for whom they may book, the mentors
 * offering a student a time and the offer's days, and the interviews and
 * times with what the app needs of them (whether feedback was sent, the
 * meeting link), each phase decided on freshform's clock.
 */
export async function practiceHomeFor(viewer: InterviewViewer): Promise<PracticeHome> {
  const { user, as, now } = viewer;
  const wallNow = programWallClock(now);

  const [data, interviews, mySlots] = await Promise.all([
    interviewsHomeData(viewer),
    prisma.peerInterview.findMany({
      where: { OR: [{ hostId: user.id }, { guestId: user.id }] },
      select: {
        id: true,
        hostId: true,
        guestId: true,
        mentorId: true,
        template: true,
        completedAt: true,
        absentId: true,
        slot: { select: { startsAt: true, minutes: true, meetingUrl: true } },
        host: { select: { id: true, name: true } },
        guest: { select: { id: true, name: true } },
        // Only this reader's own row, and only whether it was sent.
        feedback: { where: { fromId: user.id }, select: { submittedAt: true } },
      },
      orderBy: { slot: { startsAt: "asc" } },
    }),
    // The page's "Your times", in this capacity.
    prisma.interviewSlot.findMany({
      where: { userId: user.id, asMentor: as === "mentor", startsAt: { gt: wallNow } },
      select: {
        id: true,
        startsAt: true,
        minutes: true,
        meetingUrl: true,
        interview: { select: { id: true, guest: { select: { id: true, name: true } } } },
      },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  const rows = interviews.map((i) => rowOf(i, user.id, now));
  // The page's Coming up and Done: open until somebody marks it, however long ago it ended.
  const coming = rows.filter((r) => r.phase === "booked" || r.phase === "to-mark");
  const done = rows.filter((r) => r.phase === "completed" || r.phase === "absent").reverse();

  return {
    as,
    coming,
    done,
    times: mySlots.map(
      (s): OfferedSlot => ({
        id: s.id,
        when: slotTime(s),
        meetingUrl: s.meetingUrl,
        interview: s.interview && { id: s.interview.id, guest: personOf(s.interview.guest) },
      })
    ),
    classmates: [...data.offering, ...data.quiet].map(partnerRow),
    mentors: data.mentorsOffering.map(partnerRow),
    todo: as === "student" ? practiceTodo(interviews, user.id, now) : [],
    offer: { today: data.today, day: data.tomorrow, time: "15:00", lastDay: data.lastDay, lengths: [...SLOT_LENGTHS] },
    zone: PROGRAM_ZONE,
  };
}
