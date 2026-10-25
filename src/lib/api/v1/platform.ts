import "server-only";

import type { ApiPlatform, GrantLevel } from "@/lib/api/v1/types";
import { nameOf } from "@/lib/api/v1/sessions";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import type { User } from "@/generated/prisma/client";

/**
 * Platform admins, read as /settings/platform reads it: every program, and
 * everyone who could be given access (staff, mentors, anybody holding a grant),
 * with what they hold. Null for anybody who isn't a platform admin.
 */
export async function platformFor(user: User): Promise<ApiPlatform | null> {
  if (!user.platformAdmin) return null;
  const [programs, people] = await Promise.all([
    prisma.program.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({
      where: { OR: [{ role: { not: ROLES.STUDENT } }, { isMentor: true }, { staffGrants: { some: {} } }] },
      include: { staffGrants: { select: { programId: true, role: true } } },
      orderBy: [{ name: "asc" }, { email: "asc" }],
    }),
  ]);
  return {
    me: user.id,
    programs,
    people: people.map((p) => ({
      person: { id: p.id, name: nameOf(p), email: p.email },
      platformAdmin: p.platformAdmin,
      grants: p.staffGrants.map((g) => ({ program: g.programId, level: g.role as GrantLevel })),
    })),
  };
}
