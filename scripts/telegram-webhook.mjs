#!/usr/bin/env node
/**
 * Connect the Telegram bot to a deployment. Run it by hand, once per setup.
 *
 *   node scripts/telegram-webhook.mjs chats
 *       Which groups the bot has seen, with their ids — the value for
 *       TELEGRAM_CHAT_ID. Add the bot to the group, send any message there,
 *       then run this. Only works while no webhook is set (Telegram hands
 *       out updates one way or the other, never both).
 *
 *   node scripts/telegram-webhook.mjs set https://www.freshlog.net
 *       Point the bot at <url>/api/telegram/webhook, with the secret the route
 *       checks, asking only for new messages.
 *
 *   node scripts/telegram-webhook.mjs info     what Telegram thinks is set
 *   node scripts/telegram-webhook.mjs delete   stop deliveries
 *
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from the environment —
 * the same values the deployment has.
 */
const [command, url] = process.argv.slice(2);
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN first.");
  process.exit(1);
}

async function call(method, body = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!result.ok) {
    console.error(`${method} failed: ${result.description}`);
    process.exit(1);
  }
  return result.result;
}

if (command === "chats") {
  const updates = await call("getUpdates");
  const chats = new Map();
  for (const u of updates) {
    const chat = (u.message ?? u.my_chat_member)?.chat;
    if (chat && chat.type !== "private") chats.set(chat.id, chat.title);
  }
  if (chats.size === 0) console.log("No groups yet. Send a message in the group and run this again.");
  for (const [id, title] of chats) console.log(`${id}\t${title}`);
} else if (command === "set") {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!url || !secret) {
    console.error("Usage: TELEGRAM_WEBHOOK_SECRET=… node scripts/telegram-webhook.mjs set https://www.freshlog.net");
    process.exit(1);
  }
  await call("setWebhook", {
    url: `${url.replace(/\/$/, "")}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message"],
  });
  console.log("Webhook set.");
} else if (command === "info") {
  console.log(await call("getWebhookInfo"));
} else if (command === "delete") {
  await call("deleteWebhook");
  console.log("Webhook removed.");
} else {
  console.error("Usage: node scripts/telegram-webhook.mjs chats | set <url> | info | delete");
  process.exit(1);
}
