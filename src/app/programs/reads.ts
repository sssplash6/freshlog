import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { studentsWithHours, type StudentWithHours } from "@/lib/queries";
import {
  mentorStatuses,
  programStatuses,
  studentStatuses,
  type Status,
  type ViewerContext,
} from "@/lib/status";

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
 * The derivation at the bottom is shared for the same reason. `/programs` prints
 * a per-program attention COUNT and `/programs/[id]` prints the ROWS behind it;
 * two derivations would be two chances for the count to disagree with the list
 * it promises.
 */

/**
 * `Program.status`, spelled once. Two values only — see prisma/schema.prisma
 * and `programStatuses` (`lib/status.ts`), which reads the same two.
 *
 * It belongs beside `USER_STATUS` in `lib/constants.ts`; it is here because the
 * commit that added the column did not put it there, and a third spelling of
 * "ARCHIVED" is worse than a temporary home.
 */
export const PROGRAM_STATUS = { ACTIVE: "ACTIVE", ARCHIVED: "ARCHIVED" } as const;

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

/** What `studentStatuses` needs, exactly as `studentsWithHours` returns it. */
type StudentRow = {
  id: string;
  telegramUsername: string | null;
  allottedMinutes: number;
  remainingMinutes: number;
  forfeitedMinutes: number;
  nextDeadline: Date | null;
  user: { name: string | null; email: string; status: string };
};

/** What `mentorStatuses` needs, as a pairing carries it. */
type PairingRow = {
  mentorId: string;
  calendlyUrl: string | null;
  mentor: { id: string; name: string | null; email: string; status: string };
};

/**
 * Everything true and worth saying about one program's people.
 *
 * Two feeding strategies, one derivation: `/programs/[id]` hands it this
 * program's own cached reads, and `/programs` hands it slices of one bulk read
 * across the reader's whole scope — which is why it takes rows rather than an
 * id and touches the database not at all.
 *
 * It is NOT the inbox's "Needs you" narrowed to one program, and the two are
 * labelled differently — "Attention" here, "Needs you" there — so that nobody
 * reads them as the same number. The inbox asks about the whole school and
 * counts meetings and tasks; this asks about one program and counts its
 * pairings, which the inbox deliberately leaves untagged because a mentor works
 * across several.
 *
 * MENTOR ROWS ARE THIS PROGRAM'S PAIRINGS, and nothing wider. `programCount: 1`
 * is a fact, not a guess: they are paired here, so "not in any program" cannot
 * be true of them from where this page is standing. Ratings are deliberately
 * not fetched — an average is a fact about a mentor across every program they
 * teach in, so a program page claiming one would be a different number from the
 * one on their own page, computed from a subset.
 */
export function programFlags(
  program: { id: string; name: string },
  students: readonly StudentRow[],
  pairings: readonly PairingRow[],
  viewer: ViewerContext
): Status[] {
  const out: Status[] = [];

  for (const s of students) {
    out.push(
      ...studentStatuses(
        {
          id: s.id,
          name: s.user.name,
          email: s.user.email,
          accountStatus: s.user.status,
          telegramUsername: s.telegramUsername,
          allottedMinutes: s.allottedMinutes,
          remainingMinutes: s.remainingMinutes,
          forfeitedMinutes: s.forfeitedMinutes,
          nextDeadline: s.nextDeadline,
          program,
        },
        viewer
      )
    );
  }

  // One row per MENTOR, not per pairing: a mentor paired with three cohorts of
  // one program and missing every booking link is one person to go and ask.
  const missingByMentor = new Map<string, number>();
  const mentorById = new Map<string, PairingRow["mentor"]>();
  for (const p of pairings) {
    mentorById.set(p.mentorId, p.mentor);
    if (!p.calendlyUrl) {
      missingByMentor.set(p.mentorId, (missingByMentor.get(p.mentorId) ?? 0) + 1);
    }
  }
  for (const [mentorId, mentor] of mentorById) {
    out.push(
      ...mentorStatuses(
        {
          id: mentorId,
          name: mentor.name,
          email: mentor.email,
          accountStatus: mentor.status,
          programCount: 1,
          pairingsMissingLink: missingByMentor.get(mentorId) ?? 0,
        },
        viewer
      ).map((s) => ({ ...s, program }))
    );
  }

  // The program's own state. `status` is deliberately not passed: being
  // archived is said once, by the chip in the header, and a second informational
  // row underneath repeating it is the same fact charged twice. What is left is
  // PROGRAM_NO_MENTORS, which nothing else on the page can say.
  out.push(
    ...programStatuses(
      {
        id: program.id,
        name: program.name,
        mentorCount: mentorById.size,
        studentCount: students.length,
      },
      viewer
    )
  );

  return out;
}
