import "server-only";

import type { ApiPlatform, GrantLevel } from "@/lib/api/v1/types";
import { nameOf } from "@/lib/api/v1/sessions";
import { ROLES } from "@/lib/constants";
import { emailConfigured } from "@/lib/email/send";
import { prisma } from "@/lib/prisma";
import { programToday } from "@/lib/when";
import { ALLOWED_MENTOR_DOMAIN } from "../../../../config/app-config";
import type { User } from "@/generated/prisma/client";

/**
 * Platform admins, read as /settings/platform reads it: every program, and
 * everyone who could be given access (staff, mentors, anybody holding a grant),
 * with what they hold, and the page's read-only Organisation facts. Null for
 * anybody who isn't a platform admin.
 */
export async function platformFor(user: User): Promise<ApiPlatform | null> {
  if (!user.platformAdmin) return null;
  const [programs, people, lastDigest] = await Promise.all([
    prisma.program.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({
      where: { OR: [{ role: { not: ROLES.STUDENT } }, { isMentor: true }, { staffGrants: { some: {} } }] },
      include: { staffGrants: { select: { programId: true, role: true } } },
      orderBy: [{ name: "asc" }, { email: "asc" }],
    }),
    prisma.user.aggregate({ _max: { digestSentAt: true } }),
  ]);
  return {
    me: user.id,
    programs,
    people: people.map((p) => ({
      person: { id: p.id, name: nameOf(p), email: p.email },
      platformAdmin: p.platformAdmin,
      grants: p.staffGrants.map((g) => ({ program: g.programId, level: g.role as GrantLevel })),
    })),
    // The page's Organisation facts.
    organisation: {
      mentorDomain: ALLOWED_MENTOR_DOMAIN,
      emailLive: emailConfigured(),
      lastWeeklySummary: lastDigest._max.digestSentAt ? programToday(lastDigest._max.digestSentAt) : null,
    },
  };
}
