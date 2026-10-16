import "server-only";

import { cache } from "react";

import { adminScope } from "@/lib/authz";
import { canActAsMentor } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import type { User } from "@/generated/prisma/client";

/**
 * The programs whose classes this person may see: the programs with
 * `schedulesClasses` switched on that they mentor in, or administer.
 *
 * ONE question behind the nav item, the page and every action — so a Classes
 * link is never shown for a page that would be empty, and a program that has
 * not been switched on is not reachable by any route. Empty means "this person
 * has no classes anywhere", which is what keeps the feature out of every
 * department but the one that asked for it.
 */
export const classProgramIds = cache(async (user: User): Promise<string[]> => {
  const ids = new Set<string>();

  if (canActAsMentor(user)) {
    const pairings = await prisma.mentorAssignment.findMany({
      where: { mentorId: user.id, program: { schedulesClasses: true } },
      select: { programId: true },
    });
    for (const p of pairings) ids.add(p.programId);
  }

  const scope = await adminScope(user);
  const staff = await prisma.program.findMany({
    where: {
      schedulesClasses: true,
      ...(scope === "ALL" ? {} : { id: { in: [...scope] } }),
    },
    select: { id: true },
  });
  for (const p of staff) ids.add(p.id);

  return [...ids];
});
