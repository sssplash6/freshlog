import "server-only";

import { cache } from "react";

import { adminScope } from "@/lib/authz";
import { canActAsMentor, inStudentLens, PROGRAM_SPACE } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import type { Profile } from "@/lib/profile";
import type { User } from "@/generated/prisma/client";

/**
 * Which place somebody is standing in: the school, or one institute.
 *
 * Research is one program in the ledger and one row in every school-wide
 * table, and to a platform admin or an admin of three programs that is all it
 * should be. To the people whose whole work is Research — its admins, the
 * mentors paired only there, the students who study nowhere else — it is the
 * place they work, with its own name and its own levels, and a sidebar
 * offering "Programs" with one program in it was the wrong frame for them.
 *
 * A FRAME, AND NOTHING ELSE. It is chosen by what a person can already reach
 * — grants, pairings, enrollments, the same three facts every gate asks — and
 * it never adds to them or takes from them: `authz.ts` does not read it, and no
 * server action does. It changes the chrome, the sidebar's items, the home's
 * breakdown and analytics' starting point. So an institute admin and a
 * platform admin opening the same student read the same rows; one of them
 * just has "Research Institute" over the page.
 *
 * Exactly one program, and it is an institute. Somebody who also works in a
 * second program is in the school — the institute is one of the places they
 * work, not the place — and docs/archive/REDESIGN.md §4.3 holds for them unchanged.
 */
export type Space =
  | { kind: "school" }
  | {
      kind: "institute";
      programId: string;
      /** The program's colour slot, so the chrome's dot matches every table's. */
      colorIndex: number;
      /** What it is called in its own chrome: `spaceName`, else the program's name. */
      name: string;
      /** Its levels, in the order the sidebar lists them. */
      levels: { id: string; name: string }[];
    };

export const SCHOOL: Space = { kind: "school" };

/**
 * The rule, as arithmetic: the programs somebody works in, and whether that
 * set is a single institute. Pure, so the ten kinds of viewer can be tested
 * without a request.
 */
export function soleInstitute(
  programIds: Iterable<string>,
  spaceOf: (programId: string) => string | undefined
): string | null {
  const ids = new Set(programIds);
  if (ids.size !== 1) return null;
  const [only] = ids;
  return spaceOf(only) === PROGRAM_SPACE.INSTITUTE ? only : null;
}

/**
 * The programs that decide somebody's frame — the reach of the lens they are
 * in, never the union of both.
 *
 *   student      the programs they STUDY in. A visit on exchange is not a
 *                membership (`studiesIn`), so a Research student lent to
 *                Global for an afternoon stays in the institute, and a Global
 *                student visiting Research never enters it.
 *   mentor lens  the programs they are paired in
 *   admin lens   the programs they hold a grant for. A platform admin's "ALL"
 *                is the school by definition.
 */
async function framingPrograms(
  user: User,
  profile: Profile
): Promise<string[] | null> {
  if (inStudentLens(user, profile)) {
    const rows = await prisma.studentEnrollment.findMany({
      where: { student: { userId: user.id }, exchangeId: null },
      select: { programId: true },
    });
    return rows.map((r) => r.programId);
  }
  if (profile === "mentor" && canActAsMentor(user)) {
    const rows = await prisma.mentorAssignment.findMany({
      where: { mentorId: user.id },
      select: { programId: true },
    });
    return rows.map((r) => r.programId);
  }
  const scope = await adminScope(user);
  return scope === "ALL" ? null : [...scope];
}

/**
 * The frame this person sees, in the lens they are in. Request-cached and
 * keyed on the user object and lens, like `adminScope`, so the shell, the nav
 * and the page can each ask without paying three times.
 */
export const spaceOf = cache(
  async (user: User, profile: Profile): Promise<Space> => {
    const ids = await framingPrograms(user, profile);
    if (!ids || ids.length === 0) return SCHOOL;

    const programs = await prisma.program.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, space: true },
    });
    const spaces = new Map(programs.map((p) => [p.id, p.space]));
    const programId = soleInstitute(ids, (id) => spaces.get(id));
    if (!programId) return SCHOOL;

    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: {
        name: true,
        spaceName: true,
        colorIndex: true,
        levels: { orderBy: { name: "asc" }, select: { id: true, name: true } },
      },
    });
    if (!program) return SCHOOL;
    return {
      kind: "institute",
      programId,
      colorIndex: program.colorIndex,
      name: program.spaceName?.trim() || program.name,
      levels: program.levels,
    };
  }
);
