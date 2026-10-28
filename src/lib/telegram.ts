import "server-only";

/**
 * The Telegram Bot API, and the one place it is named.
 *
 * The bot sits in the team's feedback group with privacy mode OFF (BotFather →
 * /setprivacy → Disable, then add it to the group), which is what lets it read
 * every message rather than only commands and mentions. Telegram pushes each
 * message to /api/telegram/webhook; `scripts/telegram-webhook.mjs` registers
 * that address once per deployment.
 *
 * Three variables, all required, and an unset one means the feature is off —
 * the same arrangement as `dictationConfigured()`:
 *
 *   TELEGRAM_BOT_TOKEN       from BotFather
 *   TELEGRAM_WEBHOOK_SECRET  any long random string; Telegram sends it back in
 *                            a header on every update, and an update without
 *                            it is refused, since the webhook is a public URL
 *   TELEGRAM_CHAT_ID         the one group the bot listens to (a negative
 *                            number such as -1001234567890). Anything said
 *                            anywhere else — a DM, another group somebody
 *                            added it to — is ignored.
 */

export function telegramConfigured(): boolean {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN &&
      process.env.TELEGRAM_WEBHOOK_SECRET &&
      process.env.TELEGRAM_CHAT_ID
  );
}

/** The Bot API will not hand a bot a file over 20MB, so neither do we ask. */
export const TELEGRAM_FILE_MAX_BYTES = 20 * 1024 * 1024;

const api = (method: string) =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(api(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as
    | { ok: true; result: T }
    | { ok: false; description?: string }
    | null;
  if (!result?.ok) {
    throw new Error(
      `Telegram ${method} failed: ${result && !result.ok ? result.description : response.status}`
    );
  }
  return result.result;
}

/** A voice note or a photo, as bytes. Null when it is too large to fetch. */
export async function downloadFile(
  fileId: string
): Promise<Uint8Array<ArrayBuffer> | null> {
  const file = await call<{ file_path?: string; file_size?: number }>("getFile", {
    file_id: fileId,
  });
  if (!file.file_path || (file.file_size ?? 0) > TELEGRAM_FILE_MAX_BYTES) return null;
  const response = await fetch(
    `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`
  );
  if (!response.ok) throw new Error(`Telegram file download answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Mark a message the bot has filed, without a reply that adds to the noise in
 * the group. Best effort: a group can switch reactions off, and a missing 👀
 * must never undo a report that was saved.
 */
export async function react(chatId: string, messageId: number, emoji: string) {
  try {
    await call("setMessageReaction", {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: "emoji", emoji }],
    });
  } catch (error) {
    console.error("[telegram] reaction failed", error);
  }
}

/** Answer a message in the group, as a reply to it. Best effort, like `react`. */
export async function reply(chatId: string, messageId: number, text: string) {
  try {
    await call("sendMessage", {
      chat_id: chatId,
      text,
      reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
    });
  } catch (error) {
    console.error("[telegram] reply failed", error);
  }
}
