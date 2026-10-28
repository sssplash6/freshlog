import "server-only";

import type { MentorList } from "@/lib/api/v1/types";
import { nameOf, type Reader } from "@/lib/api/v1/sessions";
import { scopeProgramFilter } from "@/lib/authz";
import { PAGE_SIZE, parsePage } from "@/components/ui/pagination";
import { ROLES, USER_STATUS } from "@/lib/constants";
import { mentorsWhere, readParam, type SearchParams } from "@/lib/filters";
import { prisma } from "@/lib/prisma";
import { programOptions } from "@/lib/queries";

/**
 * The admin's Mentors list, read as /mentors reads it (`app/mentors/page.tsx`):
 * `mentorsWhere` in the reader's programs, the same order (unplaced first, by
 * pairing count, then name), and each mentor's pairings, students and ratings
 * counted only in those programs. A rating is scoped on the STUDENT's programs.
 */
export async function mentorListFor(reader: Reader, params: SearchParams): Promise<MentorList> {
  const programIds = scopeProgramFilter(reader.read);
  const page = parsePage(readParam(params, "page"));
  const where = mentorsWhere(params, { programIds });
  const inScope = programIds ? { in: [...programIds] } : undefined;

  const [mentors, total, roster, programs] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ mentorAssignments: { _count: "asc" } }, { status: "desc" }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, name: true, email: true, status: true, role: true },
    }),
    prisma.user.count({ where }),
    prisma.user.count({ where: mentorsWhere({}, { programIds }) }),
    programOptions(programIds),
  ]);
  const ids = mentors.map((m) => m.id);
  const [pairings, holdings, ratings] = await Promise.all([
    prisma.mentorAssignment.findMany({
      where: { mentorId: { in: ids }, ...(inScope ? { programId: inScope } : {}) },
      select: {
        mentorId: true,
        programId: true,
        calendlyUrl: true,
        program: { select: { id: true, name: true, colorIndex: true } },
        cohort: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.hourAllocation.findMany({
      where: { mentorId: { in: ids }, ...(inScope ? { programId: inScope } : {}) },
      select: { mentorId: true, studentId: true },
    }),
    prisma.mentorFeedback.groupBy({
      by: ["mentorId"],
      where: { mentorId: { in: ids }, ...(inScope ? { student: { enrollments: { some: { programId: inScope } } } } : {}) },
      _avg: { rating: true },
      _count: true,
    }),
  ]);

  const heldBy = new Map<string, Set<string>>();
  for (const h of holdings) {
    if (!h.mentorId) continue;
    heldBy.set(h.mentorId, (heldBy.get(h.mentorId) ?? new Set()).add(h.studentId));
  }
  const ratingOf = new Map(ratings.map((r) => [r.mentorId, r]));
  const withCohorts = new Set(programs.filter((p) => p.cohorts.length > 0).map((p) => p.id));

  return {
    rows: mentors.map((m) => {
      const theirs = pairings.filter((p) => p.mentorId === m.id);
      const rating = ratingOf.get(m.id);
      return {
        mentor: { id: m.id, name: nameOf(m), email: m.email },
        unassigned: m.status === USER_STATUS.UNASSIGNED || theirs.length === 0,
        admin: m.role === ROLES.ADMIN,
        programs: theirs.map((p) => ({
          program: p.program,
          label: p.cohort ? `${p.program.name} / ${p.cohort.name}` : withCohorts.has(p.programId) ? `${p.program.name} (all cohorts)` : p.program.name,
        })),
        pairings: theirs.length,
        pairingsWithLink: theirs.filter((p) => p.calendlyUrl).length,
        students: heldBy.get(m.id)?.size ?? 0,
        rating: rating && rating._avg.rating != null ? { average: rating._avg.rating, count: rating._count } : null,
      };
    }),
    total,
    roster,
    page,
    pageSize: PAGE_SIZE,
  };
}
