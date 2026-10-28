import { timingSafeEqual } from "node:crypto";

import { telegramConfigured } from "@/lib/telegram";
import { takeMessage, type TelegramMessageIn } from "@/lib/telegram-intake";

export const dynamic = "force-dynamic";

/**
 * Where Telegram delivers every message in the team's feedback group.
 *
 * A public URL, so the secret Telegram was given at `setWebhook` is checked
 * before the body is even parsed, and `takeMessage` then refuses any chat but
 * the one configured. Edits, joins, reactions and every other kind of update
 * are acknowledged and dropped: only new messages are read.
 *
 * A 500 asks Telegram to deliver the update again later, which is what we want
 * when the model could not be reached; anything else answers 200, because a
 * refusal Telegram retries forever helps nobody.
 */
export async function POST(request: Request) {
  if (!telegramConfigured()) {
    return Response.json({ ok: false, error: "Telegram intake is not configured." }, { status: 503 });
  }

  const sent = Buffer.from(request.headers.get("x-telegram-bot-api-secret-token") ?? "");
  const expected = Buffer.from(process.env.TELEGRAM_WEBHOOK_SECRET!);
  if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as {
    message?: TelegramMessageIn;
  } | null;
  if (!update?.message) return Response.json({ ok: true, outcome: "ignored" });

  try {
    const outcome = await takeMessage(update.message);
    return Response.json({ ok: true, outcome });
  } catch (error) {
    console.error("[telegram] could not take message", error);
    return Response.json({ ok: false, error: "Try again." }, { status: 500 });
  }
}
