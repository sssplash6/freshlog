import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, mentor, platformAdmin, student } from "@/test/db";

/**
 * Asking for your account to be deleted, and taking it back. Nothing is
 * deleted here: what is pinned is the date, that the platform admins hear once
 * with a link to the person, and that anybody signed in may ask.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const deletion = await import("@/app/api/v1/account/deletion/route");
const me = await import("@/app/api/v1/me/route");

const as = (s: { userId: string } | { id: string }) => {
  actor.value = { id: "userId" in s ? s.userId : s.id };
};
const notices = () => prisma.notification.findMany({ where: { type: "DELETION_REQUESTED" } });

beforeEach(() => {
  actor.value = null;
});

describe("account/deletion", () => {
  it("answers 401 with nobody signed in", async () => {
    expect((await deletion.POST()).status).toBe(401);
    expect((await deletion.DELETE()).status).toBe(401);
  });

  it("dates the request, tells each platform admin once, and shows on /me", async () => {
    const [a, b] = [await platformAdmin(), await platformAdmin()];
    await admin(); // a program admin, who hears nothing
    const s = await student({ name: "Aziza Karimova" });
    as(s);

    const res = await deletion.POST();
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, message: "Your account will be deleted within 30 days." });
    expect(body.requestedAt).toEqual(expect.any(String));

    const sent = await notices();
    expect(sent.map((n) => n.userId).sort()).toEqual([a.id, b.id].sort());
    expect(sent[0]).toMatchObject({ href: `/students/${s.id}`, actorId: s.userId, category: "ACCOUNTS" });
    expect(sent[0].message).toContain("Aziza Karimova asked for their account to be deleted");

    expect((await (await me.GET()).json()).deletionRequestedAt).toBe(body.requestedAt);

    // Again: the first date stands, and nobody hears twice.
    expect((await (await deletion.POST()).json()).requestedAt).toBe(body.requestedAt);
    expect(await notices()).toHaveLength(2);
  });

  it("takes it back", async () => {
    await platformAdmin();
    const m = await mentor();
    as(m);
    await deletion.POST();
    expect((await notices())[0].href).toBe(`/mentors/${m.id}`);

    expect(await (await deletion.DELETE()).json()).toMatchObject({ ok: true, requestedAt: null });
    expect((await (await me.GET()).json()).deletionRequestedAt).toBeNull();
  });

  it("lets a student nobody has approved ask too", async () => {
    as(await student({ status: "PENDING" }));
    expect((await deletion.POST()).status).toBe(200);
  });
});
