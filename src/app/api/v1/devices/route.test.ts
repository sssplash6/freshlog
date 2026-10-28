import { beforeEach, describe, expect, it, vi } from "vitest";

import { issueToken } from "@/lib/api/tokens";
import { prisma } from "@/lib/prisma";
import { mentor, student } from "@/test/db";

/**
 * A phone's push token, tied to the sign-in that registered it. What is pinned
 * is that a phone hears only the person signed in on it now: a token moves
 * when somebody else registers it, and goes when that sign-in ends.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { POST, DELETE } = await import("@/app/api/v1/devices/route");
const signout = await import("@/app/api/v1/auth/signout/route");

const TOKEN = "ExponentPushToken[abcdefghij0123]";
const call = (bearer: string | null, method: "POST" | "DELETE", body: unknown) =>
  new Request("http://test/api/v1/devices", {
    method,
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });

/** A person signed in on the app: their row, and the bearer the app holds. */
async function signedIn(user: { id: string }) {
  const { token } = await issueToken(user.id, null);
  actor.value = { id: user.id };
  return token;
}

beforeEach(() => {
  actor.value = null;
});

describe("POST /api/v1/devices", () => {
  it("answers 401 with no user, and 403 inactive to a pending student", async () => {
    expect((await POST(call(null, "POST", { token: TOKEN, platform: "ios" }))).status).toBe(401);
    const s = await student({ status: "PENDING" });
    const bearer = await signedIn({ id: s.userId });
    expect((await POST(call(bearer, "POST", { token: TOKEN, platform: "ios" }))).status).toBe(403);
  });

  it("registers the phone for the sign-in the request carries", async () => {
    const m = await mentor();
    const bearer = await signedIn(m);
    expect((await POST(call(bearer, "POST", { token: TOKEN, platform: "ios" }))).status).toBe(204);
    const row = await prisma.deviceToken.findUnique({ where: { token: TOKEN }, include: { apiToken: true } });
    expect(row).toMatchObject({ userId: m.id, platform: "ios" });
    expect(row?.apiToken.userId).toBe(m.id);
  });

  it("names the field it refuses, and wants the app's own sign-in", async () => {
    const m = await mentor();
    const bearer = await signedIn(m);
    expect(await (await POST(call(bearer, "POST", { token: "not-a-token", platform: "ios" }))).json()).toMatchObject({ field: "token" });
    expect(await (await POST(call(bearer, "POST", { token: TOKEN, platform: "web" }))).json()).toMatchObject({ field: "platform" });
    // Signed in by the website's cookie (the mocked gate lets them in) but carrying no app sign-in.
    expect((await POST(call(null, "POST", { token: TOKEN, platform: "ios" }))).status).toBe(400);
    expect(await prisma.deviceToken.count()).toBe(0);
  });

  it("moves a phone to whoever registers it next", async () => {
    const first = await mentor("First Mentor");
    await POST(call(await signedIn(first), "POST", { token: TOKEN, platform: "android" }));
    const second = await mentor("Second Mentor");
    await POST(call(await signedIn(second), "POST", { token: TOKEN, platform: "android" }));
    expect(await prisma.deviceToken.findMany({ where: { token: TOKEN } })).toMatchObject([{ userId: second.id }]);
  });
});

describe("DELETE /api/v1/devices, and signing out", () => {
  it("removes the reader's own phone, and leaves somebody else's", async () => {
    const owner = await mentor("Owner");
    await POST(call(await signedIn(owner), "POST", { token: TOKEN, platform: "ios" }));
    const other = await mentor("Other");
    const res = await DELETE(call(await signedIn(other), "DELETE", { token: TOKEN }));
    expect(res.status).toBe(204);
    expect(await prisma.deviceToken.count({ where: { token: TOKEN } })).toBe(1);

    actor.value = { id: owner.id };
    await DELETE(call(null, "DELETE", { token: TOKEN }));
    expect(await prisma.deviceToken.count()).toBe(0);
  });

  it("stops pushing to a phone once its sign-in ends", async () => {
    const m = await mentor();
    const bearer = await signedIn(m);
    await POST(call(bearer, "POST", { token: TOKEN, platform: "ios" }));
    const res = await signout.POST(new Request("http://test/api/v1/auth/signout", { method: "POST", headers: { authorization: `Bearer ${bearer}` } }));
    expect(res.status).toBe(204);
    expect(await prisma.deviceToken.count()).toBe(0);
  });

  it("refuses a revoked sign-in a phone", async () => {
    const m = await mentor();
    const bearer = await signedIn(m);
    await prisma.apiToken.updateMany({ data: { revokedAt: new Date() } });
    expect((await POST(call(bearer, "POST", { token: TOKEN, platform: "ios" }))).status).toBe(400);
  });
});
