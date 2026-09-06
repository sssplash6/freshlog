import "server-only";

import { prisma } from "@/lib/prisma";
import { notify, notificationHref } from "@/lib/notify";
import { CHARGED_SESSION, NOTIFICATION_TYPES } from "@/lib/constants";
import { formatDate, formatDuration } from "@/lib/format";

const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Deadline reminders: notifies the student AND the mentor once when an
 * allocation's deadline enters the 7-day window, and once more if it passes
 * with hours still unused. `deadlineStage` on the allocation dedupes the
 * sends and is reset whenever an admin changes the deadline. Runs from the
 * daily Render cron (see /api/cron/deadline-reminders), and from nowhere else.
 *
 * It used to run from the three dashboards on page load as a "fallback". That
 * put a write, a scan of every allocation in the school and a fan-out of
 * notifications inside the render of the page three roles open all day — so
 * the cost was paid on every visit, and the notifications went out at whatever
 * moment somebody happened to open a dashboard rather than on a schedule
 * anybody could reason about. A missed cron tick now delays reminders until
 * the next tick, which is what a missed tick should do.
 */
export async function ensureDeadlineReminders() {
  const now = new Date();
  const soon = new Date(now.getTime() + UPCOMING_WINDOW_MS);

  const due = await prisma.hourAllocation.findMany({
    where: {
      deadline: { lte: soon },
      OR: [
        { deadlineStage: null },
        { deadlineStage: "UPCOMING_SENT", deadline: { lt: now } },
      ],
    },
    include: {
      mentor: true,
      student: { include: { user: true } },
    },
  });
  if (due.length === 0) return { checked: 0, remindersSent: 0 };
  let remindersSent = 0;

  // Only mentor-held allocations can have sessions drawing them down; the
  // unassigned pool never does.
  // Keyed by (student, program, mentor) — the shape of an allocation. A key
  // without the program would let the hours a mentor delivered in one program
  // count against the deadline of the grant they hold with the same student in
  // another, and silence the reminder for time that really is about to expire.
  const pairs = due
    .filter((a) => a.mentorId)
    .map((a) => ({
      studentId: a.studentId,
      programId: a.programId,
      mentorId: a.mentorId as string,
    }));
  const sums =
    pairs.length === 0
      ? []
      : await prisma.session.groupBy({
          by: ["studentId", "programId", "mentorId"],
          // Charging sessions only: hours given out of plan never drew this
          // allocation down, so counting them would understate what is at risk
          // of expiring and silence a reminder that should have gone out.
          where: { ...CHARGED_SESSION, OR: pairs },
          _sum: { minutes: true },
        });
  const usedBy = new Map(
    sums.map((s) => [
      `${s.studentId}:${s.programId}:${s.mentorId}`,
      s._sum.minutes ?? 0,
    ])
  );

  for (const a of due) {
    const deadline = a.deadline;
    const passed = deadline.getTime() < now.getTime();
    const remaining =
      a.minutes - (usedBy.get(`${a.studentId}:${a.programId}:${a.mentorId}`) ?? 0);
    // Unassigned pool: nothing draws it down and there is no mentor to tell,
    // but the student's reminder still has to go out — those hours expire too.
    const mentorLabel = a.mentor ? (a.mentor.name ?? a.mentor.email) : null;
    const studentLabel = a.student.user.name ?? a.student.user.email;
    const date = formatDate(deadline);

    const stage = passed ? "PASSED_SENT" : "UPCOMING_SENT";
    // Nothing left to use — advance the stage silently, nobody needs a nudge.
    // Only worth telling anyone when hours are actually at stake.
    const worthSending = remaining > 0;

    await prisma.$transaction(async (tx) => {
      // Guard against a concurrent request sending the same reminder.
      const fresh = await tx.hourAllocation.findUnique({
        where: { id: a.id },
        select: { deadlineStage: true },
      });
      if (fresh?.deadlineStage === stage) return;
      await tx.hourAllocation.update({
        where: { id: a.id },
        data: { deadlineStage: stage },
      });
      if (!worthSending) return;
      remindersSent += 1;
      // No actorId: these are the clock talking, not a person. Each side gets
      // the destination that is theirs to act on.
      const withMentor = mentorLabel ? ` with ${mentorLabel}` : "";
      await notify(tx, {
        to: [a.student.userId],
        type: NOTIFICATION_TYPES.HOURS_DEADLINE,
        href: notificationHref.studentHome(),
        message: passed
          ? `Your ${date} deadline for time${withMentor} has passed — ${formatDuration(remaining)} of unused time has expired and can no longer be booked.`
          : `Reminder: use your ${formatDuration(remaining)} remaining${withMentor} by ${date}, or they expire.`,
      });
      if (a.mentorId) {
        await notify(tx, {
          to: [a.mentorId],
          type: NOTIFICATION_TYPES.HOURS_DEADLINE,
          href: notificationHref.mentorStudent(a.studentId),
          message: passed
            ? `${studentLabel}'s ${date} deadline passed with ${formatDuration(remaining)} unused — that time has expired and no new sessions can be logged against them.`
            : `${studentLabel} has ${formatDuration(remaining)} with you to use by ${date} before they expire — help them book in time.`,
        });
      }
    });
  }
  return { checked: due.length, remindersSent };
}
