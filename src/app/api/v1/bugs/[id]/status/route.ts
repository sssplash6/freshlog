import { setBugStatus } from "@/lib/actions/bugs";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { isText } from "@/lib/api/v1/session-forms";
import type { BugStatusChange } from "@/lib/api/v1/types";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Triage one report: `setBugStatus`, platform admins only. Anybody else, and no
 * such report, is the same 404, checked before the action, which would answer
 * them in words of its own. Its refusals (no fix line, a date that isn't one)
 * come back on their fields.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { id } = await params;
  if (!user.platformAdmin || !(await prisma.bugReport.findUnique({ where: { id }, select: { id: true } }))) {
    return refused("Not found.", 404);
  }
  const { status, resolution, kind, changelogDate } = ((await bodyOf(request)) ?? {}) as Partial<Record<keyof BugStatusChange, unknown>>;
  const form = new FormData();
  form.set("id", id);
  if (isText(status)) form.set("status", status);
  if (isText(resolution)) form.set("resolution", resolution);
  if (isText(kind)) form.set("kind", kind);
  if (isText(changelogDate)) form.set("changelogDate", changelogDate);
  return fromAction(await setBugStatus(null, form));
}
