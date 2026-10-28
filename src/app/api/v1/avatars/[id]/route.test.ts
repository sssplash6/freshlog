import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { mentor, PNG_BYTES, student } from "@/test/db";

/** A picture over the bearer: the website's /api/avatar/:id, under the API's gate. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/avatars/[id]/route");

const get = (id: string) => GET(new Request(`http://test/api/v1/avatars/${id}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/avatars/:id", () => {
  it("answers 401 with no user", async () => expect((await get("x")).status).toBe(401));

  it("answers 403 inactive to a pending student", async () => {
    const s = await student({ status: "PENDING" });
    actor.value = { id: s.userId };
    expect((await get(s.userId)).status).toBe(403);
  });

  it("serves anybody's picture with the website's headers", async () => {
    const face = await mentor("Akmal Karimov");
    await prisma.avatarImage.create({ data: { userId: face.id, bytes: PNG_BYTES, mimeType: "image/png" } });
    const viewer = await student();
    actor.value = { id: viewer.userId };
    const res = await get(face.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toContain("private");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("answers 404 for a person with no picture, as for nobody", async () => {
    const m = await mentor();
    actor.value = { id: m.id };
    expect((await get(m.id)).status).toBe(404);
    expect((await get("nobody")).status).toBe(404);
  });
});
