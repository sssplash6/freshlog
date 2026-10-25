import { beforeEach, describe, expect, it, vi } from "vitest";

import { issueToken } from "@/lib/api/tokens";
import { prisma } from "@/lib/prisma";
import { EXPO_CHUNK, STALE_MS, sweepPushes, type PushMessage, type PushTicket, type Sender } from "@/lib/push";
import { mentor } from "@/test/db";

/**
 * The push sweeper. What it must never do: push one notice twice, push history,
 * push a category somebody turned off, or push to a phone whose sign-in ended.
 */

const NOW = new Date("2026-10-25T12:00:00.000Z");
let seq = 0;

/** A person signed in on one phone. */
async function withPhone(name = "Akmal Karimov") {
  const user = await mentor(name);
  await issueToken(user.id, null);
  const apiToken = await prisma.apiToken.findFirstOrThrow({ where: { userId: user.id } });
  const token = `ExponentPushToken[phone${++seq}abcdef]`;
  await prisma.deviceToken.create({ data: { token, platform: "ios", userId: user.id, apiTokenId: apiToken.id } });
  return { user, token, apiToken };
}

const notice = (userId: string, opts: { category?: string; createdAt?: Date; href?: string | null; read?: boolean } = {}) =>
  prisma.notification.create({
    data: {
      userId,
      type: "SESSION_LOGGED",
      category: opts.category ?? "SESSIONS",
      message: "Akmal logged 1h with you.",
      href: opts.href === undefined ? "/student" : opts.href,
      read: opts.read ?? false,
      createdAt: opts.createdAt ?? new Date(NOW.getTime() - 30_000),
    },
  });

/** A sender that records what it was given and answers ok, or what `answer` says. */
function recorder(answer?: (m: PushMessage) => PushTicket) {
  const calls: PushMessage[][] = [];
  const send: Sender = async (messages) => {
    calls.push(messages);
    return messages.map((m) => answer?.(m) ?? { status: "ok", id: "t" });
  };
  return { calls, send };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("sweepPushes", () => {
  it("sends a notice once, with its body, badge and destination, however many sweeps run", async () => {
    const { user, token } = await withPhone();
    await notice(user.id, { read: true });
    const row = await notice(user.id, { href: "/admin/students/s1" });
    const { calls, send } = recorder();

    expect(await sweepPushes(NOW, send)).toEqual({ claimed: 2, sent: 2, skipped: 0, removed: 0 });
    expect(calls).toHaveLength(1);
    const pushed = calls[0].find((m) => m.data.notification === row.id);
    expect(pushed).toEqual({
      to: token,
      title: "freshlog",
      body: "Akmal logged 1h with you.",
      // The read one doesn't count.
      badge: 1,
      sound: "default",
      // The inbox's own translation of an old address.
      data: { notification: row.id, href: "/students/s1" },
    });

    expect(await sweepPushes(NOW, send)).toEqual({ claimed: 0, sent: 0, skipped: 0, removed: 0 });
    expect(calls).toHaveLength(1);
  });

  it("marks a notice too old to matter and sends nothing for it", async () => {
    const { user } = await withPhone();
    const old = await notice(user.id, { createdAt: new Date(NOW.getTime() - STALE_MS - 1000) });
    const { calls, send } = recorder();
    expect(await sweepPushes(NOW, send)).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });
    expect(calls).toHaveLength(0);
    expect((await prisma.notification.findUnique({ where: { id: old.id } }))?.pushedAt).toEqual(NOW);
  });

  it("never touches a row already dealt with, such as everything before push existed", async () => {
    const { user } = await withPhone();
    await prisma.notification.create({ data: { userId: user.id, type: "SESSION_LOGGED", message: "old", pushedAt: new Date("2026-01-01") } });
    const { calls, send } = recorder();
    expect(await sweepPushes(NOW, send)).toMatchObject({ claimed: 0 });
    expect(calls).toHaveLength(0);
  });

  it("sends nothing for a category whose Push is off, and the rest as usual", async () => {
    const { user } = await withPhone();
    await prisma.pushPreference.create({ data: { userId: user.id, category: "SESSIONS", on: false } });
    await notice(user.id);
    await notice(user.id, { category: "TASKS" });
    const { calls, send } = recorder();
    expect(await sweepPushes(NOW, send)).toMatchObject({ claimed: 2, sent: 1, skipped: 1 });
    expect(calls[0]).toHaveLength(1);
  });

  it("sends nothing to a phone whose sign-in was revoked or ran out, nor to somebody with no phone", async () => {
    const revoked = await withPhone("Revoked Mentor");
    await prisma.apiToken.update({ where: { id: revoked.apiToken.id }, data: { revokedAt: NOW } });
    const expired = await withPhone("Expired Mentor");
    await prisma.apiToken.update({ where: { id: expired.apiToken.id }, data: { expiresAt: new Date(NOW.getTime() - 1) } });
    const phoneless = await mentor("No Phone");
    for (const id of [revoked.user.id, expired.user.id, phoneless.id]) await notice(id);
    const { calls, send } = recorder();
    expect(await sweepPushes(NOW, send)).toMatchObject({ claimed: 3, sent: 0, skipped: 3 });
    expect(calls).toHaveLength(0);
  });

  it("deletes a phone Expo says is gone, and keeps the others", async () => {
    const gone = await withPhone("Gone Phone");
    const kept = await withPhone("Kept Phone");
    await notice(gone.user.id);
    await notice(kept.user.id);
    const { send } = recorder((m) => (m.to === gone.token ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } } : { status: "ok" }));
    expect(await sweepPushes(NOW, send)).toMatchObject({ sent: 1, removed: 1 });
    expect(await prisma.deviceToken.findMany({ select: { token: true } })).toEqual([{ token: kept.token }]);
  });

  it("sends in chunks Expo takes, and keeps the rows marked when a chunk fails", async () => {
    const { user } = await withPhone();
    const apiToken = await prisma.apiToken.findFirstOrThrow({ where: { userId: user.id } });
    // Three phones, fifty notices: 150 messages.
    for (const n of [1, 2]) {
      await prisma.deviceToken.create({ data: { token: `ExponentPushToken[extra${n}abcdef]`, platform: "android", userId: user.id, apiTokenId: apiToken.id } });
    }
    for (let i = 0; i < 50; i++) await notice(user.id);
    let first = true;
    const sizes: number[] = [];
    const send: Sender = async (messages) => {
      sizes.push(messages.length);
      if (first) {
        first = false;
        throw new Error("network");
      }
      return messages.map(() => ({ status: "ok" as const }));
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sweepPushes(NOW, send)).toMatchObject({ claimed: 50, sent: 50 });
    expect(sizes).toEqual([EXPO_CHUNK, 50]);
    expect(await prisma.notification.count({ where: { pushedAt: null } })).toBe(0);
  });
});

describe("GET /api/cron/push", () => {
  it("refuses without the secret, and sweeps with it", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [] })));
    const { GET } = await import("@/app/api/cron/push/route");
    const { NextRequest } = await import("next/server");
    expect((await GET(new NextRequest("http://test/api/cron/push"))).status).toBe(401);
    const res = await GET(new NextRequest("http://test/api/cron/push", { headers: { authorization: "Bearer s3cret" } }));
    expect(await res.json()).toEqual({ ok: true, claimed: 0, sent: 0, skipped: 0, removed: 0 });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
