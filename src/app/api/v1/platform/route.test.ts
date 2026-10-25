import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, grant, mentor, platformAdmin, program, student } from "@/test/db";

/**
 * Platform admins. What is pinned: platform admins only (anybody else, and a
 * missing person or program, the same 404), each write the website's action,
 * and the platform never left with nobody running it.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const page = await import("@/app/api/v1/platform/route");
const access = await import("@/app/api/v1/platform/people/[userId]/programs/[programId]/route");
const runs = await import("@/app/api/v1/platform/people/[userId]/admin/route");
const json = (method: string, body?: unknown) =>
  new Request("http://test/api/v1/platform", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const both = (userId: string, programId: string) => ({ params: Promise.resolve({ userId, programId }) });

beforeEach(() => {
  actor.value = null;
});

describe("Platform admins", () => {
  it("shows who administers what to a platform admin, and a 404 to anybody else", async () => {
    const p = await program("Global Admissions");
    const a = await admin("Nodira Aliyeva");
    await grant({ userId: a.id, programId: p.id, role: "LEADER" });
    await student({ programId: p.id, name: "Not Offered" });
    actor.value = { id: a.id };
    expect((await page.GET()).status).toBe(404);
    const boss = await platformAdmin("Boss");
    actor.value = { id: boss.id };
    const body = await (await page.GET()).json();
    expect(body.me).toBe(boss.id);
    expect(body.programs).toEqual([{ id: p.id, name: "Global Admissions" }]);
    expect(body.people.find((x: { person: { id: string } }) => x.person.id === a.id)).toMatchObject({ platformAdmin: false, grants: [{ program: p.id, level: "LEADER" }] });
    expect(JSON.stringify(body)).not.toContain("Not Offered");
  });

  it("gives, changes and takes away one person's access to one program", async () => {
    const p = await program("Global Admissions");
    const m = await mentor("Akmal Karimov");
    actor.value = { id: (await platformAdmin()).id };
    expect(await (await access.PUT(json("PUT", { level: "ADMIN" }), both(m.id, p.id))).json()).toMatchObject({ ok: true, message: "Akmal Karimov is now a super admin for Global Admissions." });
    await access.PUT(json("PUT", { level: "SALES" }), both(m.id, p.id));
    expect(await prisma.programStaff.findMany({ where: { userId: m.id } })).toMatchObject([{ role: "SALES" }]);
    expect(await (await access.PUT(json("PUT", { level: "OWNER" }), both(m.id, p.id))).json()).toMatchObject({ ok: false });
    await access.DELETE(json("DELETE"), both(m.id, p.id));
    expect(await prisma.programStaff.count({ where: { userId: m.id } })).toBe(0);
  });

  it("answers anybody but a platform admin, and a missing person or program, with the same 404", async () => {
    const p = await program();
    const m = await mentor();
    const a = await admin();
    await grant({ userId: a.id, programId: p.id });
    actor.value = { id: a.id };
    const notTheirs = await access.PUT(json("PUT", { level: "ADMIN" }), both(m.id, p.id));
    actor.value = { id: (await platformAdmin()).id };
    const missing = await access.PUT(json("PUT", { level: "ADMIN" }), both("nobody", p.id));
    expect(notTheirs.status).toBe(404);
    expect(await notTheirs.json()).toEqual(await missing.json());
    expect((await access.DELETE(json("DELETE"), both(m.id, "nowhere"))).status).toBe(404);
  });

  it("makes someone run the platform, and never leaves it with nobody", async () => {
    const only = await platformAdmin("Only One");
    const m = await mentor();
    actor.value = { id: only.id };
    const refused = await runs.PUT(json("PUT", { on: false }), { params: Promise.resolve({ userId: only.id }) });
    expect((await refused.json()).error).toBe("Somebody has to run the platform. Grant it to someone else first.");
    expect(await (await runs.PUT(json("PUT", { on: true }), { params: Promise.resolve({ userId: m.id }) })).json()).toMatchObject({ ok: true });
    expect((await prisma.user.findUnique({ where: { id: m.id } }))?.platformAdmin).toBe(true);
    expect((await runs.PUT(json("PUT", { on: true }), { params: Promise.resolve({ userId: "nobody" }) })).status).toBe(404);
  });
});
