import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";

import { admin, mentor, student } from "@/test/db";

/** The dismiss of a To do row: who may, which rows, and what a refusal says. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { POST } = await import("@/app/api/v1/statuses/dismiss/route");

const post = (body: unknown) =>
  POST(new Request("http://test", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const hidden = (userId: string) => prisma.statusDismissal.findMany({ where: { userId }, select: { type: true, subjectId: true } });

beforeEach(() => {
  actor.value = null;
});

describe("POST /api/v1/statuses/dismiss", () => {
  it("answers 401 with no user", async () => expect((await post({ type: "BALANCE_NONE", subjectId: "" })).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    const m = await mentor("Akmal Karimov");
    await prisma.user.update({ where: { id: m.id }, data: { status: "PENDING" } });
    actor.value = { id: m.id };
    const res = await post({ type: "BALANCE_NONE", subjectId: "" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("refuses a student: their list can't hide rows", async () => {
    const aziz = await student({ name: "Aziz Tursunov" });
    actor.value = { id: aziz.userId };
    const res = await post({ type: "BALANCE_NONE", subjectId: "" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "Your list can't hide rows." });
    expect(await hidden(aziz.userId)).toEqual([]);
  });

  it("refuses a body that isn't JSON, \"NOT_A_TYPE\" with field type, and a subjectId that isn't text", async () => {
    const m = await mentor("Akmal Karimov");
    actor.value = { id: m.id };
    expect((await post("not json")).status).toBe(400);
    const bad = await post({ type: "NOT_A_TYPE", subjectId: "" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ ok: false, field: "type" });
    const noSubject = await post({ type: "BALANCE_NONE", subjectId: 3 });
    expect(await noSubject.json()).toMatchObject({ field: "subjectId" });
    expect(await hidden(m.id)).toEqual([]);
  });

  it("a mentor hides a row and shows it again; hiding twice keeps one", async () => {
    const m = await mentor("Akmal Karimov");
    actor.value = { id: m.id };
    const first = await post({ type: "BALANCE_NONE", subjectId: "stu-1" });
    expect(first.status).toBe(204);
    expect((await post({ type: "BALANCE_NONE", subjectId: "stu-1" })).status).toBe(204);
    expect((await post({ type: "GOOGLE_RECONNECT", subjectId: "" })).status).toBe(204);
    expect(await hidden(m.id)).toEqual(
      expect.arrayContaining([
        { type: "BALANCE_NONE", subjectId: "stu-1" },
        { type: "GOOGLE_RECONNECT", subjectId: "" },
      ])
    );
    expect(await hidden(m.id)).toHaveLength(2);
  });

  it("an admin may hide a row, and only for themself", async () => {
    const a = await admin("Ada Admin");
    const m = await mentor("Akmal Karimov");
    actor.value = { id: a.id };
    expect((await post({ type: "BALANCE_NONE", subjectId: "stu-1" })).status).toBe(204);
    expect(await hidden(a.id)).toHaveLength(1);
    expect(await hidden(m.id)).toEqual([]);
  });

});
