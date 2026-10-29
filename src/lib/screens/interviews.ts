import { ROLES, USER_STATUS } from "@/lib/constants";
import { toDateInputValue } from "@/lib/format";
import { mayBook, mentorsOfStudent, studentsOfMentor } from "@/lib/interview-partners";
import type { InterviewViewer } from "@/lib/interview-viewer";
import { MAX_DAYS_AHEAD } from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";
import { programToday, programWallClock } from "@/lib/when";

/*
 * The Interviews home's data, moved unchanged from
 * src/components/interviews/interviews-home.tsx so the API's Practice reads
 * what the page shows, in either capacity: the interviews, the times this
 * person offers, the people whose times they can book (classmates, or a
 * mentor's students), the mentors offering a student a time, and the days an
 * offer may fall on.
 */

const DAY = 24 * 60 * 60 * 1000;

export type Partner = {
  id: string;
  name: string | null;
  avatarUpdatedAt: Date | null;
  programs: string[];
  open: number;
};

/** The caller gates: `viewer.user` already acts in `viewer.as`. */
export async function interviewsHomeData(viewer: InterviewViewer) {
  const { user, as, now } = viewer;
  const wallNow = programWallClock(now);

  const [interviews, mySlots, partners, mentors] = await Promise.all([
    prisma.peerInterview.findMany({
      where: { OR: [{ hostId: user.id }, { guestId: user.id }] },
      select: {
        id: true,
        hostId: true,
        guestId: true,
        template: true,
        completedAt: true,
        absentId: true,
        slot: { select: { startsAt: true, minutes: true } },
        host: { select: { id: true, name: true, avatarUpdatedAt: true } },
        guest: { select: { id: true, name: true, avatarUpdatedAt: true } },
      },
      orderBy: { slot: { startsAt: "asc" } },
    }),
    prisma.interviewSlot.findMany({
      where: { userId: user.id, asMentor: as === "mentor", startsAt: { gt: wallNow } },
      select: {
        id: true,
        startsAt: true,
        minutes: true,
        interview: { select: { id: true, guest: { select: { name: true } } } },
      },
      orderBy: { startsAt: "asc" },
    }),
    as === "mentor" ? myStudents(user.id, wallNow) : classmates(user.id, wallNow),
    as === "student" ? mentorsOfStudent(user.id, wallNow) : Promise.resolve([]),
  ]);

  const open = interviews.filter((i) => !i.completedAt && !i.absentId);
  const completed = interviews.filter((i) => i.completedAt || i.absentId).reverse();

  const named = partners.filter((p) => p.name?.trim());
  const byName = (a: Partner, b: Partner) => (a.name ?? "").localeCompare(b.name ?? "");
  const offering = named.filter((p) => p.open > 0).sort(byName);
  const quiet = named.filter((p) => p.open === 0).sort(byName);
  const mentorsOffering: Partner[] = mentors
    .filter((m) => m.interviewSlots.length > 0)
    .map((m) => ({ ...m, programs: [], open: m.interviewSlots.length }));

  const today = programToday(now);
  const tomorrow = toDateInputValue(new Date(wallNow.getTime() + DAY));
  const lastDay = toDateInputValue(new Date(wallNow.getTime() + MAX_DAYS_AHEAD * DAY));

  return { interviews, mySlots, open, completed, named, offering, quiet, mentorsOffering, today, tomorrow, lastDay };
}

/** Every other approved student, with their own programs and open student times. */
async function classmates(userId: string, wallNow: Date): Promise<Partner[]> {
  const rows = await prisma.user.findMany({
    where: {
      id: { not: userId },
      role: ROLES.STUDENT,
      status: USER_STATUS.ACTIVE,
      name: { not: null },
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
      interviewSlots: {
        where: { asMentor: false, startsAt: { gt: wallNow }, interview: null },
        select: { id: true },
      },
    },
  });
  return rows.map(partnerOf);
}

async function myStudents(mentorId: string, wallNow: Date): Promise<Partner[]> {
  return (await studentsOfMentor(mentorId, wallNow)).map(partnerOf);
}

function partnerOf(row: {
  id: string;
  name: string | null;
  avatarUpdatedAt: Date | null;
  studentProfile: { enrollments: { program: { name: string } }[] } | null;
  interviewSlots: unknown[];
}): Partner {
  return {
    id: row.id,
    name: row.name,
    avatarUpdatedAt: row.avatarUpdatedAt,
    programs: row.studentProfile?.enrollments.map((e) => e.program.name) ?? [],
    open: row.interviewSlots.length,
  };
}

/**
 * Somebody to practise with, as `InterviewPerson` reads them (moved unchanged
 * from src/components/interviews/interview-person.tsx): the person, and
 * whether the reader may book their student times and their mentor times.
 * Null for "may not" and "no such person" alike, which the page answers 404.
 */
export async function interviewPersonData(viewer: InterviewViewer, id: string) {
  const { user, as, now } = viewer;
  const person = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      role: true,
      status: true,
      isMentor: true,
      avatarUpdatedAt: true,
      studentProfile: {
        select: {
          enrollments: {
            select: { programId: true, exchangeId: true, program: { select: { name: true } } },
          },
        },
      },
      interviewSlots: {
        where: { startsAt: { gt: programWallClock(now) }, interview: null },
        select: { id: true, asMentor: true, startsAt: true, minutes: true },
        orderBy: { startsAt: "asc" },
      },
    },
  });
  if (!person?.name?.trim()) return null;

  // Each kind of time asked once: a student-who-mentors offers both.
  const [asStudent, asMentor] = await Promise.all([
    mayBook(user, as, { asMentor: false, user: person }),
    mayBook(user, as, { asMentor: true, user: person }),
  ]);
  if (!asStudent && !asMentor) return null;

  return { person, asStudent, asMentor };
}
