import { describe, expect, it } from "vitest";

import { inboxPage, markRead } from "@/lib/api/v1/inbox";
import type { InboxPage } from "@/lib/api/v1/types";
import { prisma } from "@/lib/prisma";
import { mentor, student, program } from "@/test/db";

/**
 * The inbox: the feed's order and paging, what a row says, and who may mark
 * one read. Nothing here goes through a route.
 */

async function pageOf(userId: string, query = {}): Promise<InboxPage> {
  const page = await inboxPage(userId, query);
  if ("refused" in page) throw new Error(`refused on ${page.field}: ${page.refused}`);
  return page;
}

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 20, 9, 0, seconds));

/** One notice for `userId`, made `seconds` into the morning of October 20. */
const notice = (userId: string, seconds: number, data: Partial<{ type: string; href: string | null; actorId: string; read: boolean; message: string; category: string }> = {}) =>
  prisma.notification.create({
    data: { userId, type: "SESSION_LOGGED", message: `Notice ${seconds}`, href: "/student", createdAt: at(seconds), ...data },
  });

describe("inboxPage", () => {
  it("the feed is newest first, and rows written in one createMany page without repeats or gaps", async () => {
    const aziz = await student({ name: "Aziz Tursunov" });
    // Seven rows share one instant, as one notify() call writes them; two more are older.
    await prisma.notification.createMany({
      data: [
        ...Array.from({ length: 7 }, (_, i) => ({ userId: aziz.userId, type: "TASK_SET", message: `Same ${i}`, createdAt: at(50) })),
        { userId: aziz.userId, type: "TASK_SET", message: "Old 1", createdAt: at(10) },
        { userId: aziz.userId, type: "TASK_SET", message: "Old 2", createdAt: at(5) },
      ],
    });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await pageOf(aziz.userId, { limit: "2", cursor });
      seen.push(...page.items.map((i) => i.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    const all = await prisma.notification.findMany({ where: { userId: aziz.userId } });
    expect(seen).toHaveLength(9);
    expect(new Set(seen).size).toBe(9);
    expect(new Set(seen)).toEqual(new Set(all.map((n) => n.id)));
    const full = await pageOf(aziz.userId, { limit: "100" });
    expect(full.nextCursor).toBeNull();
    expect(full.items.map((i) => i.message).slice(-2)).toEqual(["Old 1", "Old 2"]);
    expect(full.items.map((i) => i.id)).toEqual(seen);
  });

  it("only the reader's own rows, with the unread count over the whole feed", async () => {
    const aziz = await student({ name: "Aziz Tursunov" });
    const other = await student({ name: "Other Student", programId: (await program("Other Program")).id });
    await notice(aziz.userId, 1);
    await notice(aziz.userId, 2);
    await notice(aziz.userId, 3, { read: true });
    await notice(other.userId, 4);
    const page = await pageOf(aziz.userId, { limit: "1" });
    expect(page.items).toHaveLength(1);
    expect(page.unread).toBe(2);
    expect(page.nextCursor).not.toBeNull();
  });

  it("a limit that isn't 1 to 100 digits is the default; a bad cursor is refused with field cursor", async () => {
    const aziz = await student({ name: "Aziz Tursunov" });
    for (let i = 0; i < 30; i++) await notice(aziz.userId, i);
    expect((await pageOf(aziz.userId, { limit: "abc" })).items).toHaveLength(25);
    expect((await pageOf(aziz.userId, { limit: "0" })).items).toHaveLength(25);
    expect((await pageOf(aziz.userId, { limit: "500" })).items).toHaveLength(25);
    expect((await pageOf(aziz.userId, { limit: "100" })).items).toHaveLength(30);
    for (const cursor of ["!!", Buffer.from("[1,2]").toString("base64url"), Buffer.from(JSON.stringify(["nope", "x"])).toString("base64url")]) {
      expect(await inboxPage(aziz.userId, { cursor })).toEqual({ refused: "Load the list again.", field: "cursor" });
    }
  });

  it("an old /admin/students/<id> href comes back as /students/<id>", async () => {
    const aziz = await student({ name: "Aziz Tursunov" });
    await notice(aziz.userId, 1, { href: "/admin/students/abc123" });
    await notice(aziz.userId, 2, { href: null });
    const page = await pageOf(aziz.userId);
    expect(page.items.map((i) => i.href)).toEqual([null, "/students/abc123"]);
  });

  it("an unknown type reads title \"Update\"; a known one reads the website's label", async () => {
    const aziz = await student({ name: "Aziz Tursunov" });
    await notice(aziz.userId, 1, { type: "INTERVIEW_BOOKED", category: "MEETINGS" });
    await notice(aziz.userId, 2, { type: "SESSION_LOGGED" });
    const page = await pageOf(aziz.userId);
    expect(page.items.map((i) => [i.type, i.category, i.title])).toEqual([
      ["SESSION_LOGGED", "ACCOUNTS", "Session logged"],
      ["INTERVIEW_BOOKED", "MEETINGS", "Update"],
    ]);
  });

  it("names the actor, by name or else email, and is null for a system notice", async () => {
    const aziz = await student({ name: "Aziz Tursunov" });
    const akmal = await mentor("Akmal Karimov");
    await notice(aziz.userId, 1, { actorId: akmal.id });
    await notice(aziz.userId, 2);
    const page = await pageOf(aziz.userId);
    expect(page.items[0].actor).toBeNull();
    expect(page.items[1].actor).toEqual({ id: akmal.id, name: "Akmal Karimov" });
    expect(page.items[1]).toMatchObject({ read: false, at: at(1).toISOString(), message: "Notice 1" });
  });
});

describe("markRead", () => {
  it("another person's notification can't be marked read, and answers like a missing one", async () => {
    const aziz = await student({ name: "Aziz Tursunov" });
    const other = await student({ name: "Other Student", programId: (await program("Other Program")).id });
    const theirs = await notice(other.userId, 1);
    expect(await markRead(aziz.userId, theirs.id)).toBe(false);
    expect(await markRead(aziz.userId, "c-made-up")).toBe(false);
    expect(await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).toMatchObject({ read: false, readAt: null });
  });

  it("mark one read sets readAt; marking it again changes nothing", async () => {
    const aziz = await student({ name: "Aziz Tursunov" });
    const n = await notice(aziz.userId, 1);
    expect(await markRead(aziz.userId, n.id)).toBe(true);
    const first = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(first.read).toBe(true);
    expect(first.readAt).toBeInstanceOf(Date);
    expect(await markRead(aziz.userId, n.id)).toBe(true);
    const second = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(second.readAt).toEqual(first.readAt);
  });

  it("leaves the reader's other notifications unread", async () => {
    const aziz = await student({ name: "Aziz Tursunov" });
    const a = await notice(aziz.userId, 1);
    const b = await notice(aziz.userId, 2);
    await markRead(aziz.userId, a.id);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: b.id } })).read).toBe(false);
  });
});
