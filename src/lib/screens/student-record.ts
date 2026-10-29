import "server-only";

import { USER_STATUS } from "@/lib/constants";
import { deadlinePassed, soonestExpiry } from "@/lib/deadlines";
import { sortEnrollments } from "@/lib/enrollments";
import { formatDate, formatDuration } from "@/lib/format";
import { allocationSummary } from "@/lib/hours";
import { prisma } from "@/lib/prisma";

/**
 * A student's page, read once for the website (`app/students/[id]/page.tsx`)
 * and the freshlog app (`/api/v1/students/:id/record`): moved here from the
 * page, unchanged, so the two can't tell a student differently. The page's
 * comments came with the code they explain.
 */

type Hours = Awaited<ReturnType<typeof allocationSummary>>;
type Enrollment = Parameters<typeof sortEnrollments>[0][number] & {
  programId: string;
  exchangeId: string | null;
  program: { name: string };
};

/** The page's per-program lines under Progress; none for a student the reader sees in one program. */
export function programLines(studentId: string, enrollments: readonly Enrollment[]) {
  // Each program's own figures, when the totals above add up more than one —
  // so the page agrees, row by row, with the roster of every program it sums.
  return enrollments.length > 1
    ? Promise.all(
        sortEnrollments(enrollments).map(async (e) => {
          const sum = await allocationSummary(studentId, [e.programId]);
          return {
            id: e.programId,
            name: e.exchangeId ? `${e.program.name} (on exchange)` : e.program.name,
            allotted: sum.allotted,
            completed: sum.completed,
            remaining: sum.remaining,
          };
        })
      )
    : Promise.resolve([]);
}

/** May this reader log a session here, and what to say about it. */
export function logAdvice({
  hours,
  userId,
  reaches,
  status,
}: {
  hours: Hours;
  userId: string;
  reaches: boolean;
  /** The student's account status. */
  status: string;
}) {
  // May this reader log a session here?
  //
  // Reach and approval, and nothing else. It used to also require the reader
  // to hold a grant or find a live unassigned pool — which disabled the button
  // for every mentor working in the student's program who had simply not been
  // granted hours yet, and for every mentor whose allocation had expired. The
  // action never agreed: a mentor in the program may log without holding
  // anything, an in-plan log against an empty balance overdraws rather than
  // failing, and extra hours are loggable past a deadline. A button disabled
  // where the action would have said yes is a permission invented by the page.
  //
  // What the reader holds is still worth saying, so it is said as a hint under
  // the button rather than as a block on it.
  const mine = hours.perMentor.find((m) => m.mentor?.id === userId);
  const pool = hours.perMentor.find(
    (m) => !m.mentor && m.remaining > 0 && !(m.deadline && deadlinePassed(m.deadline))
  );
  const active = status === USER_STATUS.ACTIVE;
  const canLog = reaches && active;
  const logReason = !active
    ? "This student is not approved yet."
    : // "You" is the reader as a MENTOR. An admin who is not this student's
      // mentor holds no time with anybody and logs on someone else's behalf, so
      // being told "you hold no time with them" was a sentence about nothing
      // they were doing (October 2026 audit).
      !reaches
      ? undefined
      : !mine && !pool
      ? "You hold no time with them — a session you log here counts as extra time or an overdraw."
      : mine && (mine.expired || mine.remaining < 0)
        ? mine.expired
          ? // Expired is not overdrawn, and the sentence used to call it one.
            `Their time with you expired${mine.deadline ? ` on ${formatDate(mine.deadline)}` : ""}. Log the session as extra, or ask an admin to extend it.`
          : "Their time with you is already overdrawn — a session that counts toward it adds to the overdraw. Log it as extra to charge nothing."
        : undefined;
  // The warning about logging against time that is gone — said once, as a
  // callout with its glyph, rather than a bare amber sentence under the title.
  const logWarns = Boolean(mine && (mine.expired || mine.remaining < 0));
  return { canLog, logReason, logWarns };
}

/**
 * The line the page is opened for, first under the name: how much is left
 * and until when.
 *
 * A mentor reads THEIR balance with this student — "8h remaining with you · use
 * by October 17" — which used to be the last row of a table at the foot of
 * the page, under a progress card summing all three mentors. An admin reads
 * the student's whole balance in the programs they can see, with the soonest
 * date that will take some of it.
 */
export function studentHeadline({
  mentorLens,
  reaches,
  hours,
  userId,
  now,
}: {
  mentorLens: boolean;
  reaches: boolean;
  hours: Hours;
  userId: string;
  now: Date;
}): { figure: string; rest?: string; danger: boolean } | null {
  if (mentorLens && reaches) {
    const rows = hours.perMentor.filter((m) => m.mentor?.id === userId);
    if (rows.length === 0) return null;
    const left = rows.reduce((sum, m) => sum + m.remaining, 0);
    const lost = rows.reduce((sum, m) => sum + m.forfeited, 0);
    const soon = soonestExpiry(rows, now);
    if (left < 0) return { figure: `${formatDuration(-left)} over with you`, danger: true };
    if (left === 0 && lost > 0) {
      return { figure: `${formatDuration(lost)} expired unused`, rest: "with you", danger: true };
    }
    return {
      figure: `${formatDuration(left)} remaining with you`,
      rest: soon ? `use by ${formatDate(soon.date)}` : undefined,
      danger: false,
    };
  }
  if (hours.allotted === 0 && hours.used === 0) return null;
  if (hours.remaining < 0) {
    return { figure: `${formatDuration(-hours.remaining)} over`, danger: true };
  }
  return {
    figure: `${formatDuration(hours.remaining)} remaining`,
    rest: hours.expiring
      ? `${formatDuration(hours.expiring.minutes)} to use by ${formatDate(hours.expiring.date)}`
      : undefined,
    danger: false,
  };
}

/** The mentors paired with any of `programIds` (every program for undefined): the page's Allocate and Transfer offer them. */
export function mentorsIn(programIds: readonly string[] | undefined) {
  return prisma.user.findMany({
    where: {
      OR: [{ role: "MENTOR" }, { isMentor: true }],
      ...(programIds
        ? { mentorAssignments: { some: { programId: { in: [...programIds] } } } }
        : {}),
    },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, email: true },
  });
}
