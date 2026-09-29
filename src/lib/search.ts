import "server-only";

import { adminScope, scopeIsEmpty, scopeProgramFilter } from "@/lib/authz";
import {
  rankPeople,
  SEARCH_LIMIT,
  type SearchPerson,
  type SearchResults,
} from "@/lib/command-search";
import { canActAsMentor, ROLES } from "@/lib/constants";
import { enrollmentLabel } from "@/lib/enrollments";
import { mentorsWhere, studentsWhere } from "@/lib/filters";
import { prisma } from "@/lib/prisma";
import type { User } from "@/generated/prisma/client";

/**
 * How many rows the database hands back before `rankPeople` orders them.
 *
 * More than the palette shows, because the database orders by name and the
 * palette orders by how well the name matches: taking exactly eight by name
 * would drop the Aziza whose name STARTS with "az" in favour of eight people
 * who merely contain it. Twenty-five is the roster's own page size.
 */
const CANDIDATES = 25;

/**
 * Whether this reader has a roster to search, and through which lens — the
 * same two facts `/students` derives before it builds its `where`. Null for a
 * student, and for anybody who neither administers a program nor mentors.
 */
export async function searchReach(
  user: User
): Promise<{ administers: boolean; programIds?: readonly string[] } | null> {
  if (user.role === ROLES.STUDENT) return null;
  const scope = await adminScope(user);
  const administers = !scopeIsEmpty(scope);
  if (!administers && !canActAsMentor(user)) return null;
  return {
    administers,
    programIds: administers ? scopeProgramFilter(scope) : undefined,
  };
}

/**
 * Everyone the command palette may name for this reader, or null when the
 * reader has no list to search at all.
 *
 * NOT A NEW PERMISSION. Each half asks exactly what the page it links to
 * already asks, and through the same `where` builder, so the palette cannot
 * find a person the list would not show:
 *
 *   Students is `/students`: an admin reads their granted programs, somebody
 *   who only mentors reads the students they may log hours with
 *   (`loggableBy`), and nobody else has a roster. A student gets null — the
 *   student shell has no search, and the route answers them the way it
 *   answers a stranger.
 *
 *   Mentors is `/mentors`: `requireAdminAccess` lets in anybody with a
 *   non-empty scope, and `mentorsWhere` narrows them to mentors paired in it.
 *
 * The program names follow the roster's own rule — rule 1 of AGENTS.md: an
 * admin who reaches a two-program student through one program is shown that
 * program and not the other's name. A mentor's roster is narrowed by reach, not
 * by grants, and shows all of a student's programs; so does this.
 */
export async function searchFor(
  user: User,
  q: string,
  now = new Date()
): Promise<SearchResults | null> {
  const reach = await searchReach(user);
  if (!reach) return null;
  const { administers, programIds } = reach;
  const inScope = programIds ? { programId: { in: [...programIds] } } : {};
  const params = { q };

  const studentWhere = studentsWhere(
    params,
    {
      audience: administers ? "staff" : "mentor",
      userId: user.id,
      ...(administers ? { programIds } : { mentorId: user.id }),
    },
    now
  );

  const [students, mentors] = await Promise.all([
    prisma.studentProfile.findMany({
      where: studentWhere,
      select: {
        id: true,
        user: {
          select: { id: true, name: true, email: true, avatarUpdatedAt: true },
        },
        enrollments: {
          // Narrowed in the query, not after it: the other program's name
          // must never reach this process, let alone the response.
          where: inScope,
          select: {
            programId: true,
            exchangeId: true,
            program: { select: { name: true } },
          },
          orderBy: { program: { name: "asc" } },
        },
      },
      orderBy: [{ user: { name: "asc" } }, { createdAt: "asc" }],
      take: CANDIDATES,
    }),
    administers
      ? prisma.user.findMany({
          where: mentorsWhere(params, { programIds }),
          select: {
            id: true,
            name: true,
            email: true,
            avatarUpdatedAt: true,
            mentorAssignments: {
              where: inScope,
              select: { program: { select: { name: true } } },
              orderBy: { program: { name: "asc" } },
            },
          },
          orderBy: { name: "asc" },
          take: CANDIDATES,
        })
      : Promise.resolve([]),
  ]);

  const studentRows: SearchPerson[] = students.map((s) => ({
    // The profile id: `/students/[id]` is addressed by it, not by the user.
    id: s.id,
    userId: s.user.id,
    name: s.user.name,
    email: s.user.email,
    avatarUpdatedAt: s.user.avatarUpdatedAt?.toISOString() ?? null,
    // `enrollmentLabel` so a visit says it is one (AGENTS.md, "A visit is not
    // an enrollment", rule 4).
    programs: s.enrollments.map(enrollmentLabel),
  }));

  const mentorRows: SearchPerson[] = mentors.map((m) => ({
    id: m.id,
    userId: m.id,
    name: m.name,
    email: m.email,
    avatarUpdatedAt: m.avatarUpdatedAt?.toISOString() ?? null,
    // One pairing per cohort is possible, so the same program can come back
    // twice; the reader wants to know where, not how many times.
    programs: [...new Set(m.mentorAssignments.map((a) => a.program.name))],
  }));

  return {
    students: rankPeople(studentRows, q, SEARCH_LIMIT),
    mentors: rankPeople(mentorRows, q, SEARCH_LIMIT),
  };
}
