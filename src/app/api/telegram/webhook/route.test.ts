import { beforeEach, describe, expect, it, vi } from "vitest";

/** A public URL: nothing is read without Telegram's secret. */
const taken = vi.hoisted(() => ({ calls: 0, fail: false }));
vi.mock("@/lib/telegram-intake", () => ({
  takeMessage: async () => {
    taken.calls++;
    if (taken.fail) throw new Error("model down");
    return "filed";
  },
}));

const { POST } = await import("@/app/api/telegram/webhook/route");

const post = (body: unknown, secret?: string) =>
  POST(
    new Request("http://test/api/telegram/webhook", {
      method: "POST",
      headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {},
      body: JSON.stringify(body),
    })
  );

const update = { update_id: 1, message: { message_id: 1, chat: { id: -1 }, date: 0, text: "hi" } };

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "token";
  process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret-value";
  process.env.TELEGRAM_CHAT_ID = "-1";
  taken.calls = 0;
  taken.fail = false;
});

describe("POST /api/telegram/webhook", () => {
  it("refuses an update without the right secret", async () => {
    expect((await post(update)).status).toBe(401);
    expect((await post(update, "wrong")).status).toBe(401);
    expect(taken.calls).toBe(0);
  });

  it("is off until configured", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect((await post(update, "s3cret-value")).status).toBe(503);
  });

  it("takes a message", async () => {
    const response = await post(update, "s3cret-value");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "filed" });
  });

  it("acknowledges edits and other updates without reading them", async () => {
    const response = await post({ update_id: 2, edited_message: update.message }, "s3cret-value");
    expect(response.status).toBe(200);
    expect(taken.calls).toBe(0);
  });

  it("answers 500 when the message could not be taken, so Telegram retries", async () => {
    taken.fail = true;
    expect((await post(update, "s3cret-value")).status).toBe(500);
  });
});
