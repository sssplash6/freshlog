import "server-only";

import type { InboxItem, InboxPage, InboxQuery } from "@/lib/api/v1/types";
import { NOTIFICATION_META } from "@/lib/constants";
import { neutralHref } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * The signed-in person's notifications, a page at a time, newest first.
 *
 * The inbox is the notifications alone. The website's page also lists "things
 * to check" under them; the app has those on its homes as the To do list and
 * does not repeat them here.
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** The query string's inbox fields; the route reads them off the URL. */
export function inboxQueryFrom(params: URLSearchParams): InboxQuery {
  return { cursor: params.get("cursor") ?? undefined, limit: params.get("limit") ?? undefined };
}

/** Where the page before ended: the instant and id of its last row, and not the row itself. */
type Cursor = { createdAt: Date; id: string };

/** The cursor that continues after `row`: the base64url of `[createdAt ISO, id]`. */
const cursorAfter = (row: Pick<Cursor, "createdAt" | "id">): string =>
  Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString("base64url");

/** The cursor `text` is, or null when `cursorAfter` could not have made it. */
function readCursor(text: string): Cursor | null {
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(parts) || parts.length !== 2) return null;
  const [rawAt, id] = parts;
  if (typeof rawAt !== "string" || typeof id !== "string" || id === "") return null;
  const createdAt = new Date(rawAt);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== rawAt) return null;
  return { createdAt, id };
}

/**
 * Every notice after `cursor` in the feed's order (createdAt, then id, both
 * descending). One `notify()` call writes its rows with one instant, so the id
 * is what tells those apart, and no row is on two pages or on none.
 */
const after = ({ createdAt, id }: Cursor): Prisma.NotificationWhereInput => ({
  OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
});

/** The page size `text` asks for: 1 to 100 as digits, and the default for anything else. */
function limitOf(text: string | undefined): number {
  const asked = text !== undefined && /^\d+$/.test(text) ? Number(text) : NaN;
  return asked >= 1 && asked <= MAX_LIMIT ? asked : DEFAULT_LIMIT;
}

type Row = Prisma.NotificationGetPayload<{ include: { actor: { select: { id: true; name: true; email: true } } } }>;

function toInboxItem(row: Row): InboxItem {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    // Old rows hold types the product has dropped; the website calls those "Update".
    title: NOTIFICATION_META[row.type]?.label ?? "Update",
    message: row.message,
    href: row.href ? neutralHref(row.href) : null,
    actor: row.actor ? { id: row.actor.id, name: row.actor.name ?? row.actor.email } : null,
    read: row.read,
    at: row.createdAt.toISOString(),
  };
}

export async function inboxPage(
  userId: string,
  query: InboxQuery
): Promise<InboxPage | { refused: string; field: string }> {
  let cursor: Cursor | null = null;
  if (query.cursor !== undefined) {
    cursor = readCursor(query.cursor);
    if (!cursor) return { refused: "Load the list again.", field: "cursor" };
  }
  const limit = limitOf(query.limit);
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, ...(cursor ? after(cursor) : {}) },
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);
  const items = rows.slice(0, limit);
  return {
    items: items.map(toInboxItem),
    nextCursor: rows.length > limit ? cursorAfter(items[items.length - 1]) : null,
    unread,
  };
}

/**
 * Marks one of `userId`'s notifications read, and says whether it is theirs.
 *
 * The website does this in `/n/[id]`, which redirects and so can't be called
 * from the app; this is the same update, and it stamps `readAt` as
 * `markAllNotificationsRead` does. A notice already read is left as it is.
 * Another person's id and one that was never made are the same `false`.
 */
export async function markRead(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.notification.updateMany({
    where: { id, userId, read: false },
    data: { read: true, readAt: new Date() },
  });
  if (count > 0) return true;
  return (await prisma.notification.count({ where: { id, userId } })) > 0;
}
