"use server";

import { revalidatePath } from "next/cache";

import { adminWriteScope, scopeCovers } from "@/lib/authz";
import {
  CLASS_STATUS,
  MAX_CLASS_DAYS_AHEAD,
  MAX_CLASS_MINUTES,
  fitsAllocation,
  reservedMinutes,
} from "@/lib/class-schedule";
import { canActAsMentor, CHARGED_SESSION, USER_STATUS } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";
import { formatDuration, formatFullDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { parseDateField, parseMinutesField, type ActionState } from "@/lib/actions/shared";
import { remainingWithMentor } from "@/lib/hours";
import { programWallClock } from "@/lib/when";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TOPIC_MAX = 120;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * A mentor puts a class in the diary for one of their students.
 *
 * A class is a PLAN: it draws nothing down. What it does is RESERVE — it is
 * refused when it would promise more time than the student still holds with
 * this mentor, counting the classes already booked and not yet held. That is
 * the whole of "allocating the hours": a mentor cannot schedule past what was
 * granted, and the reserved minutes are visible before they are spent.
 *
 * Only a mentor, only in a program with `schedulesClasses` on, and only for a
 * student they hold time with in it. Reaching a student by program is enough to
 * LOG a meeting; it is not enough to book hours that were never granted.
 *
 * Times are the program's wall clock (Tashkent), stored in a UTC field — the
 * convention `when.ts` explains — so a month is the month the mentor sees.
 */
export async function scheduleClass(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const mentor = await getCurrentUser();
  if (!mentor || !canActAsMentor(mentor) || mentor.status !== USER_STATUS.ACTIVE) {
    return { ok: false, error: "Only assigned mentors can schedule classes." };
  }

  const studentId = String(formData.get("studentId") ?? "");
  const programId = String(formData.get("programId") ?? "");

  const minutes = parseMinutesField(formData.get("minutes"), {
    min: 5,
    max: MAX_CLASS_MINUTES,
    label: "Length",
  });
  if ("error" in minutes) return { ok: false, error: minutes.error, field: "minutes" };

  const day = parseDateField(formData.get("date"));
  if ("error" in day) return { ok: false, error: day.error, field: "date" };
  const time = TIME_RE.exec(String(formData.get("time") ?? "").trim());
  if (!time) return { ok: false, error: "Pick a start time.", field: "time" };
  const startsAt = new Date(day.value.getTime() + (Number(time[1]) * 60 + Number(time[2])) * MINUTE);

  // Past and far-future are both refused on the program's own clock: `now` is a
  // real instant, `startsAt` a wall clock, so one is turned into the other first.
  const now = programWallClock(new Date());
  if (startsAt.getTime() < now.getTime()) {
    return { ok: false, error: "A class can't start in the past. Log a meeting that already happened as a session.", field: "date" };
  }
  if (startsAt.getTime() > now.getTime() + MAX_CLASS_DAYS_AHEAD * DAY) {
    return { ok: false, error: "That is more than a year away. Pick a nearer date.", field: "date" };
  }

  const topic = String(formData.get("topic") ?? "").replace(/\s+/g, " ").trim().slice(0, TOPIC_MAX) || null;

  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { id: true, name: true, schedulesClasses: true },
  });
  // The same words for "no such program" and "not switched on": the setting is
  // not something a mentor outside it should be able to probe.
  if (!program || !program.schedulesClasses) {
    return { ok: false, error: "Classes aren't scheduled in this program." };
  }
  const pairing = await prisma.mentorAssignment.findFirst({
    where: { mentorId: mentor.id, programId },
    select: { id: true },
  });
  if (!pairing) return { ok: false, error: "You don't mentor in this program." };

  const allocation = await prisma.hourAllocation.findUnique({
    where: { studentId_programId_mentorId: { studentId, programId, mentorId: mentor.id } },
    include: { student: { include: { user: true } } },
  });
  if (!allocation) {
    return { ok: false, error: "That student holds no time with you in this program.", field: "studentId" };
  }
  if (allocation.student.user.status !== USER_STATUS.ACTIVE) {
    return { ok: false, error: "That student hasn't been approved yet.", field: "studentId" };
  }
  // The hours' use-by date is a day, stored at UTC midnight; a class on that day
  // is still inside it.
  if (startsAt.getTime() >= allocation.deadline.getTime() + DAY) {
    return {
      ok: false,
      error: `Their hours with you are use-by ${formatFullDate(allocation.deadline)}. Pick a day on or before it.`,
      field: "date",
    };
  }

  const name = allocation.student.user.name ?? allocation.student.user.email;

  // The reserve check and the write share a transaction, so two classes booked
  // at once cannot both pass a check that only one of them fits.
  return prisma.$transaction(async (tx) => {
    const [remaining, booked, clash] = await Promise.all([
      remainingWithMentor(studentId, programId, mentor.id),
      tx.scheduledClass.findMany({
        where: { studentId, programId, mentorId: mentor.id, status: CLASS_STATUS.SCHEDULED },
        select: { minutes: true, status: true },
      }),
      // Overlap with ANY of this mentor's other classes, in any program: a
      // person cannot teach two at once.
      tx.scheduledClass.findMany({
        where: {
          mentorId: mentor.id,
          status: CLASS_STATUS.SCHEDULED,
          startsAt: {
            gt: new Date(startsAt.getTime() - MAX_CLASS_MINUTES * MINUTE),
            lt: new Date(startsAt.getTime() + minutes.value * MINUTE),
          },
        },
        select: { startsAt: true, minutes: true },
      }),
    ]);

    const left = remaining ?? 0;
    const reserved = reservedMinutes(booked);
    if (!fitsAllocation(left, reserved, minutes.value)) {
      const free = Math.max(0, left - reserved);
      return {
        ok: false as const,
        error:
          free === 0
            ? `${name} has nothing unreserved with you${reserved > 0 ? ` — ${formatDuration(reserved)} is already booked in classes` : ""}.`
            : `That is ${formatDuration(minutes.value)}, and ${name} has ${formatDuration(free)} unreserved with you${reserved > 0 ? ` (${formatDuration(reserved)} is booked in classes)` : ""}.`,
        field: "minutes",
      };
    }
    const overlapping = clash.find(
      (c) => c.startsAt.getTime() + c.minutes * MINUTE > startsAt.getTime()
    );
    if (overlapping) {
      return { ok: false as const, error: "You already have a class at that time.", field: "time" };
    }

    await tx.scheduledClass.create({
      data: {
        studentId,
        programId,
        mentorId: mentor.id,
        startsAt,
        minutes: minutes.value,
        topic,
      },
    });
    revalidatePath("/classes");
    return {
      ok: true as const,
      message: `Booked ${formatDuration(minutes.value)} with ${name} on ${formatFullDate(startsAt)}. ${formatDuration(left - reserved - minutes.value)} still unreserved.`,
    };
  });
}

/**
 * Take a class out of the diary. The mentor who booked it may, and so may an
 * admin of its program; the minutes it reserved go back at once, because only
 * SCHEDULED classes reserve anything. The row is kept, as CANCELLED, so the
 * month it was in still says it happened.
 */
export async function cancelClass(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const row = await prisma.scheduledClass.findUnique({
    where: { id: String(formData.get("classId") ?? "") },
  });
  // "Not yours" and "does not exist" read the same.
  const allowed =
    row !== null &&
    (row.mentorId === actor.id || scopeCovers(await adminWriteScope(actor), row.programId));
  if (!row || !allowed) return { ok: false, error: "Class not found." };
  if (row.status !== CLASS_STATUS.SCHEDULED) {
    return { ok: false, error: "Only a class still to come can be cancelled." };
  }

  await prisma.scheduledClass.update({
    where: { id: row.id },
    data: { status: CLASS_STATUS.CANCELLED },
  });
  revalidatePath("/classes");
  return { ok: true, message: `Cancelled. ${formatDuration(row.minutes)} is unreserved again.` };
}

/**
 * Mark a class as held by tying it to the session that delivered it.
 *
 * Hours are charged by sessions and by nothing else, so this does not log one:
 * it finds the ACTIVE session the mentor already logged for this student, in
 * this program, on the class's day, that no other class has claimed — and links
 * it. From then on the class stops reserving, because the session is charging.
 * With no such session the answer is to log it first; a "held" class with
 * nothing behind it would be an hour that was promised, never spent and never
 * released.
 */
export async function markClassHeld(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const row = await prisma.scheduledClass.findUnique({
    where: { id: String(formData.get("classId") ?? "") },
  });
  if (!row || row.mentorId !== actor.id) return { ok: false, error: "Class not found." };
  if (row.status !== CLASS_STATUS.SCHEDULED) {
    return { ok: false, error: "That class is already closed." };
  }
  if (row.startsAt.getTime() > programWallClock(new Date()).getTime()) {
    return { ok: false, error: "It hasn't started yet." };
  }

  const dayStart = new Date(Date.UTC(row.startsAt.getUTCFullYear(), row.startsAt.getUTCMonth(), row.startsAt.getUTCDate()));
  const session = await prisma.session.findFirst({
    where: {
      studentId: row.studentId,
      programId: row.programId,
      mentorId: row.mentorId,
      date: dayStart,
      ...CHARGED_SESSION,
      scheduledClass: null,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!session) {
    return {
      ok: false,
      error: `No session is logged for this class's day yet. Log it first, then mark the class held.`,
    };
  }

  await prisma.scheduledClass.update({
    where: { id: row.id },
    data: { status: CLASS_STATUS.HELD, sessionId: session.id },
  });
  revalidatePath("/classes");
  return { ok: true, message: "Marked held, against the session you logged." };
}
