import "server-only";

import { interviewPhase } from "@/lib/peer-interviews";
import { prisma } from "@/lib/prisma";

/**
 * Practice interviews as an admin reads them: who met whom, when, for how
 * long, and whether it happened.
 *
 * Only that. What the students answered, the notes they kept and the feedback
 * they wrote each other are theirs and their mentors' (`interviewsOfStudent`,
 * gated on `mentorHasWorkedWith`), and none of it is selected here — the
 * privacy lives in the query, so no page built on this can render it by
 * accident. Emails are not selected either: a partner may study in a program
 * the reader has no standing in, so they are a name and a face, as everywhere
 * else a classmate is shown.
 *
 * A mentor on one side is named like a partner from elsewhere: never "ours",
 * so they get no row in the per-student totals.
 *
 * Which interviews: those with at least one student who studies — their own
 * enrollment, not a visit — in a program the reader administers. An interview
 * has no program of its own, and its two students may study in different
 * programs: the admins of each one see it. `programIds` undefined is a platform admin: everything.
 */
export async function interviewsForStaff(
  programIds: readonly string[] | undefined,
  now: Date
) {
  const ownIn = programIds
    ? { exchangeId: null, programId: { in: [...programIds] } }
    : { exchangeId: null };
  const side = {
    select: {
      id: true,
      name: true,
      avatarUpdatedAt: true,
      studentProfile: {
        select: {
          id: true,
          // Non-empty when this student is the reader's own: they get a row in
          // the per-student totals. A partner from elsewhere is only named.
          enrollments: { where: ownIn, select: { programId: true }, take: 1 },
        },
      },
    },
  } as const;

  const rows = await prisma.peerInterview.findMany({
    where: programIds
      ? {
          OR: [
            { host: { studentProfile: { enrollments: { some: ownIn } } } },
            { guest: { studentProfile: { enrollments: { some: ownIn } } } },
          ],
        }
      : {},
    select: {
      id: true,
      template: true,
      completedAt: true,
      absentId: true,
      hostId: true,
      guestId: true,
      mentorId: true,
      slot: { select: { startsAt: true, minutes: true } },
      host: side,
      guest: side,
    },
    orderBy: { slot: { startsAt: "desc" } },
  });

  return rows.map((row) => {
    const person = (s: typeof row.host) => ({
      // Where an admin opens them; a mentor has no student page.
      profileId: s.studentProfile?.id ?? "",
      // The mentor side is never one of the reader's students, even a
      // student-who-mentors.
      ours: s.id !== row.mentorId && (s.studentProfile?.enrollments.length ?? 0) > 0,
      id: s.id,
      name: s.name,
      avatarUpdatedAt: s.avatarUpdatedAt,
      email: "",
    });
    return {
      id: row.id,
      startsAt: row.slot.startsAt,
      minutes: row.slot.minutes,
      template: row.template,
      phase: interviewPhase(row, now),
      host: person(row.host),
      guest: person(row.guest),
      absent:
        row.absentId === row.hostId
          ? ("host" as const)
          : row.absentId === row.guestId
            ? ("guest" as const)
            : null,
    };
  });
}

export type PrepInterview = Awaited<ReturnType<typeof interviewsForStaff>>[number];
type PrepPerson = PrepInterview["host"];

export type PrepStudent = {
  person: PrepPerson;
  /** Interviews marked done, and their minutes: the time actually practised. */
  held: number;
  minutesHeld: number;
  /** Booked and still ahead. */
  upcoming: number;
  /** Times this student was marked absent by their partner. */
  missed: number;
  /** The last interview they took part in that is no longer ahead. */
  lastAt: Date | null;
};

/**
 * One row per student the reader administers who has booked at least one
 * interview, most time practised first.
 *
 * Only a COMPLETED interview counts as time practised: one still waiting to be
 * marked may not have happened, and one where a partner was marked absent did
 * not, for either of them.
 */
export function prepByStudent(interviews: readonly PrepInterview[]): PrepStudent[] {
  const by = new Map<string, PrepStudent>();
  for (const iv of interviews) {
    for (const side of ["host", "guest"] as const) {
      const person = iv[side];
      if (!person.ours) continue;
      const row =
        by.get(person.id) ??
        { person, held: 0, minutesHeld: 0, upcoming: 0, missed: 0, lastAt: null };
      if (iv.phase === "completed") {
        row.held += 1;
        row.minutesHeld += iv.minutes;
      }
      if (iv.phase === "booked") row.upcoming += 1;
      if (iv.absent === side) row.missed += 1;
      if (iv.phase !== "booked" && (!row.lastAt || iv.startsAt > row.lastAt)) {
        row.lastAt = iv.startsAt;
      }
      by.set(person.id, row);
    }
  }
  return [...by.values()].sort(
    (a, b) =>
      b.minutesHeld - a.minutesHeld ||
      b.held - a.held ||
      (a.person.name ?? "").localeCompare(b.person.name ?? "")
  );
}
