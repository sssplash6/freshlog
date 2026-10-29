import { sendOnExchange } from "@/lib/actions/exchanges";
import { bodyOf } from "@/lib/api/v1/body";
import { fromAction, inactive, mayUse, refused, signInAgain } from "@/lib/api/v1/respond";
import { isText } from "@/lib/api/v1/session-forms";
import type { ExchangeSend } from "@/lib/api/v1/types";
import { isDay } from "@/lib/api/v1/work-forms";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Sends a student on exchange: the website's `sendOnExchange`, which takes an
 * admin of the program they leave or a mentor who works in it, caps what the
 * host may allocate, and raises the cap when one is already open between the
 * two. The body is judged field by field first; the rest is the action's.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const { from, to, minutes, useBy, note } = ((await bodyOf(request)) ?? {}) as Partial<Record<keyof ExchangeSend, unknown>>;
  const field = !isText(from)
    ? "from"
    : !isText(to)
      ? "to"
      : !(Number.isInteger(minutes) && (minutes as number) > 0)
        ? "minutes"
        : !isDay(useBy)
          ? "useBy"
          : note !== undefined && typeof note !== "string"
            ? "note"
            : null;
  if (field) return refused("That isn't a valid value.", 400, { field });
  const form = new FormData();
  form.set("studentProfileId", (await params).id);
  form.set("fromProgramId", from as string);
  form.set("toProgramId", to as string);
  form.set("minutes", String(minutes));
  form.set("deadline", useBy as string);
  form.set("note", typeof note === "string" ? note : "");
  return fromAction(await sendOnExchange(null, form));
}
