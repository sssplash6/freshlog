import { setProgramAccess } from "@/lib/actions/grants";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import type { AccessSet } from "@/lib/api/v1/types";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

const LEVELS = new Set(["ADMIN", "LEADER", "SALES"]);

/**
 * A person's whole access set in one write, as the website's Platform settings
 * saves it: `setProgramAccess`, which replaces every grant they hold with the
 * programs named, in one transaction, so a dropped connection leaves either
 * the old set or the new one. A program left out is one they no longer
 * administer. The person must exist and the reader be a platform admin;
 * otherwise the same 404.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { userId } = await params;
  if (!user.platformAdmin || !(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
    return refused("Not found.", 404);
  }
  const { programs } = ((await bodyOf(request)) ?? {}) as Partial<Record<keyof AccessSet, unknown>>;
  const valid =
    Array.isArray(programs) &&
    programs.every((g) => typeof g === "object" && g !== null && typeof g.program === "string" && LEVELS.has(g.level));
  if (!valid) return refused("Send each program with its level.", 400, { field: "programs" });
  const form = new FormData();
  form.set("userId", userId);
  for (const g of programs as AccessSet["programs"]) {
    form.append("program", g.program);
    form.set(`level:${g.program}`, g.level);
  }
  return fromAction(await setProgramAccess(null, form));
}
