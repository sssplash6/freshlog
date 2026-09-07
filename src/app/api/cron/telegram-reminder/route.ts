import type { NextRequest } from "next/server";

import { sendTelegramReminders } from "@/lib/telegram-reminder";

export const dynamic = "force-dynamic";

/**
 * "Add your Telegram username" — the nudge for students who signed up before
 * the app insisted on one, and who therefore cannot be reached by any other
 * channel (see `lib/telegram-reminder.ts`).
 *
 * Not on a schedule in `render.yaml`. It is a job somebody decides to run, and
 * the fourteen-day cooldown inside it is what makes running it twice safe
 * rather than rude. Guarded by CRON_SECRET like the other two, since this is a
 * public URL that sends real mail.
 *
 *   ?preview=1        compose and count; send nothing, stamp nobody
 *   ?only=<email>     one address, for a test against a real inbox
 *   ?force=1          ignore the cooldown
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, error: "CRON_SECRET is not configured on this deployment." },
      { status: 503 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const only = url.searchParams.get("only");
  const result = await sendTelegramReminders({
    ...(only ? { only } : {}),
    force: url.searchParams.get("force") === "1",
    preview: url.searchParams.get("preview") === "1",
  });
  return Response.json({ ok: true, ...result });
}
