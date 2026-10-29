import "server-only";

import { adminScope, scopeProgramFilter } from "@/lib/authz";
import { readParam, type SearchParams } from "@/lib/filters";
import { mentorWindow } from "@/lib/mentor-window";
import { prisma } from "@/lib/prisma";
import { mentorAssignments, mentorOverview, programOptions } from "@/lib/queries";
import type { User } from "@/generated/prisma/client";

/**
 * A mentor's record, read once for the website (`app/mentors/[id]/page.tsx`)
 * and the freshlog app (`/api/v1/mentors/:id`): moved here from the page,
 * unchanged, so the two can't tell a mentor's time differently. The page's
 * comments came with the code they explain.
 */
export async function mentorRecordView({
  viewer,
  mentor,
  isSelf,
  edits,
  query,
  now,
}: {
  viewer: User;
  mentor: { id: string };
  isSelf: boolean;
  /** The reader may change the mentor: the page's Edit fold reads the program picker. */
  edits: boolean;
  query: SearchParams;
  now: Date;
}) {
  /**
   * Which programs this reader may see of this mentor's.
   *
   * `undefined` means every one, which is both a platform admin and the mentor
   * reading their own record — their own work is not somebody's grant to
   * narrow. For a scoped admin it is their grants, and every figure below is
   * summed from rows that carry it.
   */
  const programIds = isSelf
    ? undefined
    : scopeProgramFilter(await adminScope(viewer));
  const inReach = (programId: string) =>
    !programIds || programIds.includes(programId);

  const win = mentorWindow(query, now);
  // The date fields open for a typed range, and for the Custom tab before
  // anything is typed — an empty pair of fields is how it asks for one.
  const choosingDates = win.kind === "custom" || readParam(query, "period") === "custom";

  const [allPairings, overview, feedback, pickerPrograms] = await Promise.all([
    mentorAssignments(mentor.id),
    mentorOverview(mentor.id, { from: win.from, to: win.to }),
    prisma.mentorFeedback.aggregate({
      where: {
        mentorId: mentor.id,
        ...(programIds
          ? { student: { enrollments: { some: { programId: { in: [...programIds] } } } } }
          : {}),
      },
      _avg: { rating: true },
      _count: true,
    }),
    // The picker is built from the READER's programs, which is what makes an
    // unticked box safe to read as a removal: a pairing in a program they do
    // not hold draws no row, and `updateMentor` refuses to delete what drew no
    // row. Only fetched when there is an Edit fold to put it in.
    edits ? programOptions(programIds) : Promise.resolve([]),
  ]);

  /**
   * Everything narrowed to the reader's programs, in one place.
   *
   * `mentorOverview` has no scope argument — it takes a single `programId` or
   * none — so the narrowing happens here, over the rows it returns. The totals
   * are then summed from those same rows rather than re-derived from the
   * database: a scoped admin's "delivered" is genuinely a different number from
   * a platform admin's, and summing the rows the table already shows is what
   * keeps the figure and the table agreeing.
   */
  const pairings = allPairings.filter((a) => inReach(a.programId));
  const byProgram = overview.byProgram.filter((row) => inReach(row.id));
  // A balance row and a session each name their own program now, so the
  // narrowing asks the row rather than the student — who may study in a program
  // this reader does not hold.
  const students = overview.students.filter((s) => inReach(s.program.id));
  const sessions = overview.sessions.filter((s) => inReach(s.programId));
  // Every program the header names gets a row, even one with nothing in it
  // yet. The header listed "efde" and the table did not, so the two halves of
  // the page disagreed about where this mentor works.
  const listed = new Set(byProgram.map((row) => row.id));
  const idle = [
    ...new Map(
      pairings
        .filter((a) => !listed.has(a.programId))
        .map((a) => [a.programId, { id: a.programId, name: a.program.name, colorIndex: a.program.colorIndex }])
    ).values(),
  ];
  const sum = (pick: (row: (typeof byProgram)[number]) => number) =>
    byProgram.reduce((total, row) => total + pick(row), 0);
  // The program table is the Students ledger summed by program — every
  // session ever logged against these grants, whatever the window above. Its
  // Completed and Missed were the window's while its Total and Remaining were
  // the ledger's, so under "30 days" a row read 2h completed of 40h with 10h
  // remaining and could not be made to add up.
  const ledger = byProgram.map((row) => {
    const held = students.filter((s) => s.program.id === row.id);
    const total = (pick: (s: (typeof held)[number]) => number) =>
      held.reduce((sum, s) => sum + pick(s), 0);
    // The bank's meetings are this mentor's work too, and spend none of the
    // grants summed above — left out, a program they only ever met students in
    // through a bank read "0 min" under a headline that counted those hours.
    return {
      ...row,
      completedAll: total((s) => s.completed) + row.bankCompleted,
      missedAll: total((s) => s.missed) + row.bankMissed,
    };
  });
  const programMissed = ledger.some((r) => r.missedAll > 0);
  const programExtra = ledger.some((r) => r.extraAll > 0);
  const programExpired = ledger.some((r) => r.forfeited > 0);
  return {
    programIds,
    inReach,
    win,
    choosingDates,
    pairings,
    byProgram,
    students,
    sessions,
    listed,
    idle,
    sum,
    ledger,
    programMissed,
    programExtra,
    programExpired,
    allPairings,
    overview,
    feedback,
    pickerPrograms,
  };
}
