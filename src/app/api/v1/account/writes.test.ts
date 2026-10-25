import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { mentor, pairing, PNG_BYTES, program, student } from "@/test/db";

/**
 * Account's writes, as the signed-in `actor`. Each is the reader's own; what is
 * pinned is that the actions' words come back on the field they are about, and
 * that a pairing that isn't yours is the same 404 as one that doesn't exist.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const name = await import("@/app/api/v1/account/name/route");
const telegram = await import("@/app/api/v1/account/telegram/route");
const avatar = await import("@/app/api/v1/account/avatar/route");
const notices = await import("@/app/api/v1/account/notices/[category]/route");
const digest = await import("@/app/api/v1/account/weekly-digest/route");
const booking = await import("@/app/api/v1/account/booking-links/[id]/route");
const push = await import("@/app/api/v1/account/push/[category]/route");
const account = await import("@/app/api/v1/account/route");

const as = (s: { userId: string } | { id: string }) => {
  actor.value = { id: "userId" in s ? s.userId : s.id };
};
const put = (body: unknown) =>
  new Request("http://test/api/v1/account", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  actor.value = null;
});

describe("PUT account/name", () => {
  it("answers 401 with no user, and 403 inactive to a pending student", async () => {
    expect((await name.PUT(put({ name: "A B" }))).status).toBe(401);
    as(await student({ status: "PENDING" }));
    expect((await name.PUT(put({ name: "A B" }))).status).toBe(403);
  });

  it("renames the reader, and refuses one word in the action's words, on the field", async () => {
    const m = await mentor("Akmal Karimov");
    as(m);
    const bad = await name.PUT(put({ name: "Akmal" }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ field: "name", error: "Enter your full name — first and last, not just one word." });
    expect((await name.PUT(put({}))).status).toBe(400);

    const res = await name.PUT(put({ name: "  Akmal   Karimovich " }));
    expect(await res.json()).toMatchObject({ ok: true, message: "Name saved." });
    expect((await prisma.user.findUnique({ where: { id: m.id } }))?.name).toBe("Akmal Karimovich");
  });
});

describe("PUT account/telegram", () => {
  it("saves a student's handle without the @", async () => {
    const s = await student();
    as(s);
    expect((await (await telegram.PUT(put({ telegram: "@aziza_k" }))).json()).ok).toBe(true);
    expect((await prisma.studentProfile.findUnique({ where: { id: s.id } }))?.telegramUsername).toBe("aziza_k");

    const bad = await telegram.PUT(put({ telegram: "ab" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).field).toBe("telegram");
  });

  it("tells a mentor, in the action's words, that only students have one", async () => {
    as(await mentor());
    const res = await telegram.PUT(put({ telegram: "akmal_k" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Only students have a Telegram handle here.");
  });
});

describe("PUT and DELETE account/avatar", () => {
  const upload = (bytes: Uint8Array<ArrayBuffer>, type = "image/png") => {
    const form = new FormData();
    form.set("avatar", new File([bytes], "picture", { type }));
    return new Request("http://test/api/v1/account/avatar", { method: "PUT", body: form });
  };

  it("sets the picture from the bytes, and removes it", async () => {
    const m = await mentor();
    as(m);
    expect(await (await avatar.PUT(upload(PNG_BYTES))).json()).toMatchObject({ ok: true, message: "Picture updated." });
    expect((await prisma.avatarImage.findUnique({ where: { userId: m.id } }))?.mimeType).toBe("image/png");
    expect((await prisma.user.findUnique({ where: { id: m.id } }))?.avatarUpdatedAt).not.toBeNull();

    expect(await (await avatar.DELETE()).json()).toMatchObject({ ok: true, message: "Picture removed." });
    expect(await prisma.avatarImage.findUnique({ where: { userId: m.id } })).toBeNull();
  });

  it("refuses what isn't an image, whatever it claims, and a body that isn't multipart", async () => {
    as(await mentor());
    const res = await avatar.PUT(upload(new TextEncoder().encode("<html>hi</html>"), "image/png"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "avatar", error: "That file isn't a PNG, JPEG, or WebP image." });
    expect((await avatar.PUT(put({ avatar: "x" }))).status).toBe(400);
  });

  it("refuses one too large after resizing", async () => {
    as(await mentor());
    const big = new Uint8Array(301 * 1024);
    big.set(PNG_BYTES);
    const res = await avatar.PUT(upload(big));
    expect((await res.json()).error).toMatch(/too large/);
  });
});

describe("PUT account/notices/:category", () => {
  it("stores a row only where the switches differ from the default", async () => {
    const m = await mentor();
    as(m);
    await notices.PUT(put({ inApp: true, email: true }), params({ category: "HOURS" }));
    expect(await prisma.notificationPreference.findMany({ where: { userId: m.id } })).toMatchObject([{ category: "HOURS", inApp: true, email: true }]);
    // Back to the default (in the app, no email): the row goes.
    const res = await notices.PUT(put({ inApp: true, email: false }), params({ category: "HOURS" }));
    expect(await res.json()).toEqual({ ok: true });
    expect(await prisma.notificationPreference.count({ where: { userId: m.id } })).toBe(0);
  });

  it("answers 404 for a category that isn't one, and 400 for a switch that isn't a boolean", async () => {
    as(await mentor());
    expect((await notices.PUT(put({ inApp: true, email: true }), params({ category: "WEEKLY_SUMMARY" }))).status).toBe(404);
    const bad = await notices.PUT(put({ inApp: true, email: "yes" }), params({ category: "TASKS" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).field).toBe("email");
  });
});

describe("PUT account/weekly-digest", () => {
  it("writes the column and the preference row together", async () => {
    const m = await mentor();
    as(m);
    await digest.PUT(put({ on: false }));
    expect((await prisma.user.findUnique({ where: { id: m.id } }))?.weeklyDigest).toBe(false);
    expect(await prisma.notificationPreference.findFirst({ where: { userId: m.id, category: "WEEKLY_SUMMARY" } })).toMatchObject({ email: false });
    await digest.PUT(put({ on: true }));
    expect((await prisma.user.findUnique({ where: { id: m.id } }))?.weeklyDigest).toBe(true);
    expect((await digest.PUT(put({}))).status).toBe(400);
  });
});

describe("PUT account/booking-links/:id", () => {
  it("sets the link on the reader's own pairing, https only", async () => {
    const m = await mentor();
    const p = await program("Global Admissions");
    const a = await pairing({ mentorId: m.id, programId: p.id });
    as(m);
    const http = await booking.PUT(put({ url: "http://cal.example/akmal" }), params({ id: a.id }));
    expect(await http.json()).toMatchObject({ field: "url", error: "The booking URL must use https." });

    const res = await booking.PUT(put({ url: "https://cal.example/akmal" }), params({ id: a.id }));
    expect(await res.json()).toMatchObject({ ok: true, message: "Booking link for Global Admissions saved." });
    expect((await prisma.mentorAssignment.findUnique({ where: { id: a.id } }))?.calendlyUrl).toBe("https://cal.example/akmal");
  });

  it("answers another mentor's pairing as it answers one that doesn't exist", async () => {
    const p = await program();
    const theirs = await pairing({ mentorId: (await mentor("Other Mentor")).id, programId: p.id });
    as(await mentor());
    const a = await booking.PUT(put({ url: "https://cal.example/x" }), params({ id: theirs.id }));
    const b = await booking.PUT(put({ url: "https://cal.example/x" }), params({ id: "missing" }));
    expect(a.status).toBe(404);
    expect(await a.json()).toEqual(await b.json());
    expect((await prisma.mentorAssignment.findUnique({ where: { id: theirs.id } }))?.calendlyUrl).toBeNull();
  });
});

describe("PUT account/push/:category", () => {
  const pushOf = async (category: string) =>
    (await (await account.GET()).json()).notices.find((n: { category: string }) => n.category === category).push;

  it("is on by default, stores off, and deletes the row when turned back on", async () => {
    const m = await mentor();
    as(m);
    expect(await pushOf("SESSIONS")).toBe(true);
    expect(await (await push.PUT(put({ on: false }), params({ category: "SESSIONS" }))).json()).toEqual({ ok: true });
    expect(await pushOf("SESSIONS")).toBe(false);
    expect(await pushOf("HOURS")).toBe(true);
    await push.PUT(put({ on: true }), params({ category: "SESSIONS" }));
    expect(await pushOf("SESSIONS")).toBe(true);
    expect(await prisma.pushPreference.count({ where: { userId: m.id } })).toBe(0);
  });

  it("answers 404 for a category that isn't one, and 400 for a switch that isn't a boolean", async () => {
    as(await mentor());
    expect((await push.PUT(put({ on: false }), params({ category: "WEEKLY_SUMMARY" }))).status).toBe(404);
    expect(await (await push.PUT(put({ on: "no" }), params({ category: "TASKS" }))).json()).toMatchObject({ field: "on" });
  });

  it("leaves the email switch alone, and the email writer leaves it alone", async () => {
    const m = await mentor();
    as(m);
    await push.PUT(put({ on: false }), params({ category: "TASKS" }));
    // TASKS back at its email default: setNotificationPreference deletes its own row, never this one.
    await notices.PUT(put({ inApp: true, email: true }), params({ category: "TASKS" }));
    expect(await pushOf("TASKS")).toBe(false);
  });
});
