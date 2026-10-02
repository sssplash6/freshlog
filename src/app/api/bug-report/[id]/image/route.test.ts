import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { bugReport, mentor, platformAdmin } from "@/test/db";

const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/bug-report/[id]/image/route");

const get = (id: string) =>
  GET(new Request(`http://localhost/api/bug-report/${id}/image`), {
    params: Promise.resolve({ id }),
  });

describe("GET /api/bug-report/[id]/image", () => {
  it("is 401 when signed out", async () => {
    const r = await bugReport({ image: true });
    actor.value = null;
    expect((await get(r.id)).status).toBe(401);
  });

  it("serves the reporter their own screenshot, with safe headers", async () => {
    const me = await mentor();
    const r = await bugReport({ reporterId: me.id, image: true });
    actor.value = me;

    const res = await get(r.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toContain("private");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("serves a platform admin any screenshot", async () => {
    const me = await mentor();
    const r = await bugReport({ reporterId: me.id, image: true });
    actor.value = await platformAdmin();
    expect((await get(r.id)).status).toBe(200);
  });

  it("answers somebody else, an unknown id, and a report with no image identically", async () => {
    const me = await mentor("Me");
    const other = await mentor("Other");
    const withImage = await bugReport({ reporterId: me.id, image: true });
    const without = await bugReport({ reporterId: me.id });

    actor.value = other;
    const stranger = await get(withImage.id);
    actor.value = me;
    const noImage = await get(without.id);
    const unknown = await get("no-such-id");

    for (const res of [stranger, noImage, unknown]) {
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not found");
    }
  });
});
