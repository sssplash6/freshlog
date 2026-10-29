import { returnExchange } from "@/lib/actions/exchanges";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import type { ExchangeReturn } from "@/lib/api/v1/types";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Calls an exchange off: the website's `returnExchange`, for whoever sent the
 * student or an admin of either program, refused once a session was logged
 * under it. What the placement made goes with it, and both programs are told.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { note } = ((await bodyOf(request)) ?? {}) as Partial<Record<keyof ExchangeReturn, unknown>>;
  if (note !== undefined && typeof note !== "string") return refused("That isn't a valid value.", 400, { field: "note" });
  const form = new FormData();
  form.set("exchangeId", (await params).id);
  form.set("note", note ?? "");
  return fromAction(await returnExchange(null, form));
}
