import "server-only";

import type { PushData } from "@/lib/api/v1/types";
import { followableHref } from "@/lib/api/v1/inbox";
import { prisma } from "@/lib/prisma";

/**
 * Pushes, for the freshlog app: every notice `notify()` writes, sent to the
 * reader's phones within a minute.
 *
 * `notify()` only writes Notification rows, and every producer calls it, often
 * inside the transaction of the thing it describes. So nothing is sent from
 * there: a push sent from inside a transaction can announce something that is
 * then rolled back. Instead this sweeper, run every minute by the Render cron
 * (`/api/cron/push`), takes the rows nobody has dealt with (`pushedAt` null),
 * claims each one, and sends what is due through Expo's push service.
 *
 * Losing a push is better than repeating one: a row is marked before it is
 * sent, and a failed send is logged, never retried.
 */

/** A message as Expo's push service takes it. */
export type PushMessage = {
  to: string;
  title: string;
  body: string;
  badge: number;
  sound: "default";
  data: PushData;
};

/** Expo's answer for one message, in the order they were sent. */
export type PushTicket =
  | { status: "ok"; id?: string }
  | { status: "error"; message?: string; details?: { error?: string } };

/** Sends one chunk; answers its tickets. Injected, so a test never reaches the network. */
export type Sender = (messages: PushMessage[]) => Promise<PushTicket[]>;

/** Rows taken per sweep. A minute's notices in a school this size are a handful. */
export const SWEEP_BATCH = 200;
/** Expo takes at most 100 messages a request. */
export const EXPO_CHUNK = 100;
/** A notice older than this when the sweeper first sees it is marked and not sent: that late, a push is noise. */
export const STALE_MS = 60 * 60 * 1000;

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Expo's push service. `EXPO_PUSH_URL` replaces the address (a local stub, for
 * a walk), and `EXPO_ACCESS_TOKEN` is sent when the project requires one.
 */
export const expoSend: Sender = async (messages) => {
  const token = process.env.EXPO_ACCESS_TOKEN;
  const res = await fetch(process.env.EXPO_PUSH_URL || EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Expo's push service answered ${res.status}.`);
  const body = (await res.json()) as { data?: PushTicket[] };
  return body.data ?? [];
};

export type SweepResult = {
  /** Rows this sweep took. */
  claimed: number;
  /** Messages Expo accepted. */
  sent: number;
  /** Rows taken but sent to nobody: too old, no phone, or Push off. */
  skipped: number;
  /** Phones Expo said are gone, and were deleted. */
  removed: number;
};

/**
 * One sweep. Takes up to SWEEP_BATCH rows not dealt with yet, oldest first,
 * and claims them in one write of `pushedAt` where it is still null, so two
 * sweeps that overlap cannot both send one row. Then, for each fresh row, a
 * message to each of the reader's live phones (their sign-in not revoked, not
 * expired) unless they turned that category's Push off.
 */
export async function sweepPushes(now: Date, send: Sender): Promise<SweepResult> {
  const rows = await prisma.notification.findMany({
    where: { pushedAt: null },
    orderBy: { createdAt: "asc" },
    take: SWEEP_BATCH,
    select: { id: true, userId: true, category: true, message: true, href: true, createdAt: true },
  });

  // One write claims them all; the rows that read back with this sweep's
  // `now` are the ones it won. A sweep that overlapped claimed the rest first.
  const ids = rows.map((r) => r.id);
  let mine: typeof rows = [];
  if (ids.length) {
    await prisma.notification.updateMany({ where: { id: { in: ids }, pushedAt: null }, data: { pushedAt: now } });
    const won = await prisma.notification.findMany({ where: { id: { in: ids }, pushedAt: now }, select: { id: true } });
    const claimed = new Set(won.map((r) => r.id));
    mine = rows.filter((r) => claimed.has(r.id));
  }

  const fresh = mine.filter((r) => now.getTime() - r.createdAt.getTime() <= STALE_MS);
  const readers = [...new Set(fresh.map((r) => r.userId))];
  const [devices, offs, unread] = readers.length
    ? await Promise.all([
        prisma.deviceToken.findMany({
          where: { userId: { in: readers }, apiToken: { revokedAt: null, expiresAt: { gt: now } } },
          select: { token: true, userId: true },
        }),
        prisma.pushPreference.findMany({ where: { userId: { in: readers }, on: false } }),
        unreadBadges(readers),
      ])
    : [[], [], []];

  const phonesOf = new Map<string, string[]>();
  for (const d of devices) phonesOf.set(d.userId, [...(phonesOf.get(d.userId) ?? []), d.token]);
  const off = new Set(offs.map((p) => `${p.userId}|${p.category}`));
  const unreadOf = new Map(unread);

  const messages: PushMessage[] = [];
  let skipped = mine.length - fresh.length;
  for (const row of fresh) {
    const phones = off.has(`${row.userId}|${row.category}`) ? [] : (phonesOf.get(row.userId) ?? []);
    if (phones.length === 0) {
      skipped++;
      continue;
    }
    for (const to of phones) {
      messages.push({
        to,
        title: "freshlog",
        body: row.message,
        badge: unreadOf.get(row.userId) ?? 0,
        sound: "default",
        data: { notification: row.id, href: followableHref(row.href) },
      });
    }
  }

  let sent = 0;
  const gone: string[] = [];
  for (let i = 0; i < messages.length; i += EXPO_CHUNK) {
    const chunk = messages.slice(i, i + EXPO_CHUNK);
    let tickets: PushTicket[];
    try {
      tickets = await send(chunk);
    } catch (error) {
      console.error("Push: Expo's push service could not be reached; these pushes are dropped.", error);
      continue;
    }
    tickets.forEach((ticket, j) => {
      if (ticket.status === "ok") sent++;
      else if (ticket.details?.error === "DeviceNotRegistered") gone.push(chunk[j].to);
      else console.error("Push: Expo refused a message.", ticket.message ?? ticket.details?.error);
    });
  }
  if (gone.length) await prisma.deviceToken.deleteMany({ where: { token: { in: gone } } });

  return { claimed: mine.length, sent, skipped, removed: gone.length };
}

/**
 * Each reader's unread count for the badge, as the bell counts it: what they
 * turned off In app is left out (`mutedCategories`), so the phone's icon never
 * says more than the app's own bell.
 */
async function unreadBadges(readers: string[]): Promise<[string, number][]> {
  const [rows, muted] = await Promise.all([
    prisma.notification.groupBy({ by: ["userId", "category"], where: { userId: { in: readers }, read: false }, _count: true }),
    prisma.notificationPreference.findMany({ where: { userId: { in: readers }, inApp: false }, select: { userId: true, category: true } }),
  ]);
  const off = new Set(muted.map((m) => `${m.userId}|${m.category}`));
  const total = new Map<string, number>();
  for (const r of rows) {
    if (!off.has(`${r.userId}|${r.category}`)) total.set(r.userId, (total.get(r.userId) ?? 0) + r._count);
  }
  return [...total];
}
