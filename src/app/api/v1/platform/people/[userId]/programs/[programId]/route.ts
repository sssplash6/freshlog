import { removeProgramGrant, setProgramGrant } from "@/lib/actions/grants";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import { isText } from "@/lib/api/v1/session-forms";
import type { AccessChange } from "@/lib/api/v1/types";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string; programId: string }> };

/** Both must exist; a reader who isn't a platform admin gets the same 404. */
async function found(platformAdmin: boolean, userId: string, programId: string): Promise<boolean> {
  if (!platformAdmin) return false;
  const [person, program] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    prisma.program.findUnique({ where: { id: programId }, select: { id: true } }),
  ]);
  return Boolean(person && program);
}

const formOf = (userId: string, programId: string) => {
  const form = new FormData();
  form.set("userId", userId);
  form.set("programId", programId);
  return form;
};

/** Give one person one level in one program, without touching their others: `setProgramGrant`. */
export async function PUT(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { userId, programId } = await params;
  if (!(await found(user.platformAdmin, userId, programId))) return refused("Not found.", 404);
  const { level } = ((await bodyOf(request)) ?? {}) as Partial<Record<keyof AccessChange, unknown>>;
  if (!isText(level)) return refused("Pick an access level.", 400, { field: "level" });
  const form = formOf(userId, programId);
  form.set("role", level);
  return fromAction(await setProgramGrant(null, form));
}

/** Take one person's access to one program away: `removeProgramGrant`. */
export async function DELETE(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { userId, programId } = await params;
  if (!(await found(user.platformAdmin, userId, programId))) return refused("Not found.", 404);
  return fromAction(await removeProgramGrant(null, formOf(userId, programId)));
}
