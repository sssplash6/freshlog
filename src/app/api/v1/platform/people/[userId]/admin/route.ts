import { setPlatformAdmin } from "@/lib/actions/grants";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, refused, signInAgain } from "@/lib/api/v1/respond";
import type { PlatformAdminChange } from "@/lib/api/v1/types";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Make someone a platform admin, or stop: `setPlatformAdmin`, which refuses to
 * leave the platform with nobody running it. The person must exist, and the
 * reader be a platform admin; otherwise the same 404.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { userId } = await params;
  if (!user.platformAdmin || !(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
    return refused("Not found.", 404);
  }
  const { on } = ((await bodyOf(request)) ?? {}) as Partial<Record<keyof PlatformAdminChange, unknown>>;
  if (typeof on !== "boolean") return refused("Say whether they run the platform.", 400, { field: "on" });
  const form = new FormData();
  form.set("userId", userId);
  if (on) form.set("platformAdmin", "on");
  return fromAction(await setPlatformAdmin(null, form));
}
