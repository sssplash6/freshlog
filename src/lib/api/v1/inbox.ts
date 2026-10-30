import "server-only";

import type { InboxItem, InboxPage, InboxQuery } from "@/lib/api/v1/types";
import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_META,
  type NotificationCategory,
} from "@/lib/constants";
import { mutedCategories, neutralHref } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { summarizeUnread } from "@/lib/unread";
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

/** The order the website's chips read in (`/notifications`' CATEGORY_ORDER): what changes most often, first. */
const CATEGORY_ORDER: NotificationCategory[] = [
  NOTIFICATION_CATEGORY.SESSIONS,
  NOTIFICATION_CATEGORY.HOURS,
  NOTIFICATION_CATEGORY.TASKS,
  NOTIFICATION_CATEGORY.DEADLINES,
  NOTIFICATION_CATEGORY.ACCOUNTS,
];
const isCategory = (value: string): value is NotificationCategory => (CATEGORY_ORDER as string[]).includes(value);

/**
 * A notice's link as the website's `/n/[id]` follows it: only an in-app path
 * (`inAppPath` there: never `//host` or `/\host`, which a browser reads as
 * another site), with old shapes rewritten (`neutralHref`). Null for any other.
 */
export function followableHref(href: string | null): string | null {
  if (!href || !href.startsWith("/") || href.startsWith("//") || href.startsWith("/\\")) return null;
  return neutralHref(href);
}

/**
 * What the bell's number is made of, as the website's shell reads it
 * (`summarizeUnread`): the total, and the deadlines in it, which the bell's
 * name calls out. Like the bell, it leaves out what the reader turned off In app.
 */
export async function unreadOf(userId: string): Promise<{ unread: number; unreadDeadlines: number }> {
  const { total, urgent } = await unreadSummaryOf(userId, await mutedCategories(userId));
  return { unread: total, unreadDeadlines: urgent };
}

async function unreadSummaryOf(userId: string, muted: string[]) {
  const rows = await prisma.notification.groupBy({
    by: ["category"],
    where: { userId, read: false, category: { notIn: muted } },
    _count: true,
  });
  return summarizeUnread(rows.map((r) => ({ category: r.category, count: r._count })));
}

/** The query string's inbox fields; the route reads them off the URL. */
export function inboxQueryFrom(params: URLSearchParams): InboxQuery {
  return {
    cursor: params.get("cursor") ?? undefined,
    limit: params.get("limit") ?? undefined,
    category: params.get("category") ?? undefined,
  };
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

/** The page size `text` asks for: 1 to 100 as digits, the default when left out, null for anything else. */
function limitOf(text: string | undefined): number | null {
  if (text === undefined) return DEFAULT_LIMIT;
  const asked = /^\d+$/.test(text) ? Number(text) : NaN;
  return asked >= 1 && asked <= MAX_LIMIT ? asked : null;
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
    href: followableHref(row.href),
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
  if (limit === null) return { refused: "Send a page size from 1 to 100.", field: "limit" };
  if (query.category !== undefined && !isCategory(query.category)) return { refused: "Pick a category.", field: "category" };
  // What the reader turned off In app is left out of the list and every count,
  // as on the website; a muted category asked for by name is an empty page.
  const muted = await mutedCategories(userId);
  const [rows, unread, byCategory] = await Promise.all([
    prisma.notification.findMany({
      where: {
        userId,
        category: { notIn: muted, ...(query.category ? { equals: query.category } : {}) },
        ...(cursor ? after(cursor) : {}),
      },
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    }),
    unreadSummaryOf(userId, muted),
    // Counted across the whole feed, as the website's chips are: a chip is a category the reader has anything in.
    prisma.notification.groupBy({ by: ["category"], where: { userId, category: { notIn: muted } }, _count: true }),
  ]);
  const items = rows.slice(0, limit);
  const countOf = new Map(byCategory.map((c) => [c.category, c._count]));
  return {
    items: items.map(toInboxItem),
    nextCursor: rows.length > limit ? cursorAfter(items[items.length - 1]) : null,
    unread: unread.total,
    unreadBy: unread.parts,
    categories: CATEGORY_ORDER.flatMap((category) =>
      countOf.has(category) ? [{ category, label: NOTIFICATION_CATEGORY_LABELS[category], count: countOf.get(category)! }] : []
    ),
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
