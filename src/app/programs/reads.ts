import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { studentsWithHours, type StudentWithHours } from "@/lib/queries";

/**
 * The reads every program page shares, each asked once per request.
 *
 * §6.12 names this as a defect rather than a nicety: the layout ran
 * `program.findUnique` + `studentsWithHours` (`admin/programs/[id]/layout.tsx:26-42`)
 * and the page under it ran the identical pair (`page.tsx:97-107`), so opening a
 * program paid for both twice — and the two could disagree, because each called
 * the clock for itself and forfeiture is judged against a moment. `cache()`
 * makes the layout's call and the page's call the same call, with the same
 * answer.
 *
 * `programFlags` used to live at the bottom, deriving what needed a person in
 * one program — an Attention count on `/programs`, the rows behind it on
 * `/programs/[id]`. Both are gone: every such row is behind the bell now, in
 * `lib/attention.ts`, which asks about the reader's whole scope rather than one
 * program at a time.
 */

/**
 * `Program.status`, spelled once — now in `lib/constants.ts`, beside
 * `USER_STATUS`, which is where this comment always said it belonged. Re-exported
 * rather than moved out from under its readers: the program pages ask this file
 * for everything else about a program.
 */
export { PROGRAM_STATUS } from "@/lib/constants";

/**
 * One instant for the whole request.
 *
 * A layout and its page render in parallel and each would otherwise call the
 * clock for itself, so the header's "212h remaining" and the list's per-student
 * figures could be computed either side of a use-by date passing. Stable
 * identity is also what lets the reads below memoise: `cache()` compares
 * arguments with `Object.is`, so a fresh `new Date()` per call would key every
 * caller separately and defeat the whole file.
 */
export const requestNow = cache((): Date => new Date());

/** The program row. 404 when it is not there. */
export const programOf = cache(async (id: string) => {
  const program = await prisma.program.findUnique({ where: { id } });
  // `notFound`, matching `requireProgramScope`: a program outside the reader's
  // grants and a program that does not exist have to answer identically, or the
  // difference between the two answers is a way to ask whether an id is real.
  if (!program) notFound();
  return program;
});

/**
 * Everyone enrolled, with their hours IN THIS PROGRAM. The one source of every
 * total on every page about it.
 *
 * `programIds: [id]` is doing real work: a student who also studies in another
 * program brings none of that program's minutes — or its name — onto this page.
 */
export const programStudents = cache((id: string) =>
  studentsWithHours(
    { enrollments: { some: { programId: id } } },
    { now: requestNow(), programIds: [id] }
  )
);

/** Mentor pairings — the program's own rows, not the mentors' whole reach. */
export const programPairings = cache((id: string) =>
  prisma.mentorAssignment.findMany({
    where: { programId: id },
    include: { mentor: true, cohort: true },
    orderBy: { createdAt: "asc" },
  })
);

/** Cohorts with what is in them, for Settings and for the cohort filter. */
export const programCohorts = cache((id: string) =>
  prisma.cohort.findMany({
    where: { programId: id },
    orderBy: { name: "asc" },
    include: { _count: { select: { enrollments: true, mentorAssignments: true } } },
  })
);

/** Who administers it. Read-only everywhere except `/settings/platform` (§8.4). */
export const programGrants = cache((id: string) =>
  prisma.programStaff.findMany({
    where: { programId: id },
    include: {
      user: {
        select: { id: true, name: true, email: true, avatarUpdatedAt: true },
      },
    },
    orderBy: { createdAt: "asc" },
  })
);

/**
 * One student's row as it reads INSIDE one program: their figures for that
 * program, over their identity.
 *
 * The projection every "per program" total goes through. A student in two
 * programs has one row from `studentsWithHours` carrying both the combined
 * figures and a `byProgram` map; a page about one program wants the map's
 * entry, and adding the two together — which is what filtering the rows and
 * summing them used to do — would put Global Admissions' hours in the Master's
 * Program's total and count the person twice.
 *
 * Returns null when they are not in that program, so callers `flatMap`.
 */
export function inProgram(row: StudentWithHours, programId: string) {
  const figures = row.byProgram.get(programId);
  return figures ? { ...row, ...figures } : null;
}

/** Every student of a set, as they read inside one program. */
export function studentsOf(
  rows: readonly StudentWithHours[],
  programId: string
) {
  return rows.flatMap((r) => {
    const scoped = inProgram(r, programId);
    return scoped ? [scoped] : [];
  });
}
