import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { mentor, student } from "@/test/db";

/**
 * /me is how somebody who is not active yet learns why. So it answers 200 to
 * every signed-in person whatever their status, and 401 only to nobody.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/me/route");

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/me", () => {
  it("answers 401 with no user", async () => {
    expect((await GET()).status).toBe(401);
  });

  it("tells the app to sign in again, in the words and the code it looks for", async () => {
    expect(await (await GET()).json()).toEqual({
      ok: false,
      error: "Sign in again.",
      code: "unauthenticated",
    });
  });

  it("answers a pending student with 200 and what they are waiting for", async () => {
    const s = await student({ name: "Aziz Tursunov", status: "PENDING" });
    actor.value = { id: s.userId };
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).onboarding).toBe("student-profile");
  });

  it("answers an unassigned mentor with 200 too", async () => {
    const m = await prisma.user.update({
      where: { id: (await mentor("Akmal Karimov")).id },
      data: { status: "UNASSIGNED" },
    });
    actor.value = { id: m.id };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: m.id, status: "UNASSIGNED", onboarding: "unassigned" });
  });

  it("answers a set-up student with who they are and nothing left to do", async () => {
    const s = await student({ name: "Malika Rahimova" });
    await prisma.studentProfile.update({ where: { id: s.id }, data: { telegramUsername: "malika_r" } });
    actor.value = { id: s.userId };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      studentProfileId: s.id,
      name: "Malika Rahimova",
      roles: ["student"],
      onboarding: null,
    });
  });

  it("is never cached, because the same address answers for everyone", async () => {
    const m = await mentor("Akmal Karimov");
    actor.value = { id: m.id };
    expect((await GET()).headers.get("cache-control")).toBe("no-store");
    actor.value = null;
    expect((await GET()).headers.get("cache-control")).toBe("no-store");
  });
});
