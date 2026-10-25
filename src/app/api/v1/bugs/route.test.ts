import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUG_REPORTS_PER_HOUR } from "@/lib/bugs";
import { prisma } from "@/lib/prisma";
import { bugReport, mentor, platformAdmin, PNG_BYTES, student } from "@/test/db";

/**
 * Bug reports as the signed-in `actor`. What is pinned is who reads what: your
 * own reports, the fix lines of everybody's (and nothing the reporter wrote),
 * and nobody else's report or screenshot, which is the same 404 as none.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const list = await import("@/app/api/v1/bugs/route");
const one = await import("@/app/api/v1/bugs/[id]/route");
const image = await import("@/app/api/v1/bugs/[id]/image/route");

const as = (u: { id: string }) => {
  actor.value = { id: u.id };
};
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://test/api/v1/bugs");

function report(fields: Record<string, string>, shot?: Uint8Array<ArrayBuffer>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (shot) form.set("screenshot", new File([shot], "shot.png", { type: "image/png" }));
  return new Request("http://test/api/v1/bugs", { method: "POST", body: form });
}

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/bugs", () => {
  it("answers 401 with no user, and 403 inactive to a pending student", async () => {
    expect((await list.GET()).status).toBe(401);
    const s = await student({ status: "PENDING" });
    actor.value = { id: s.userId };
    expect((await list.GET()).status).toBe(403);
  });

  it("lists my reports with freshform's labels, and others' fixes without their words", async () => {
    const me = await mentor();
    const other = await mentor("Other Mentor");
    await bugReport({ reporterId: me.id, title: "My open one", createdAt: new Date("2026-10-20T20:30:00Z") });
    await bugReport({ reporterId: me.id, title: "My won't do", status: "CLOSED", resolution: "Works as meant." });
    await bugReport({
      reporterId: other.id,
      title: "Aziza's hours are wrong",
      description: "Aziza Karimova shows 3h",
      status: "FIXED",
      resolution: "Totals add up again.",
      resolvedAt: new Date("2026-10-21T10:00:00Z"),
    });
    as(me);
    const body = await (await list.GET()).json();
    expect(body.mine.map((r: { title: string }) => r.title).sort()).toEqual(["My open one", "My won't do"]);
    const open = body.mine.find((r: { title: string }) => r.title === "My open one");
    // 20:30 UTC is the next morning in Tashkent.
    expect(open).toMatchObject({ status: "PENDING", statusLabel: "New", open: true, sentOn: "2026-10-21" });
    expect(body.mine.find((r: { title: string }) => r.title === "My won't do")).toMatchObject({ statusLabel: "Won't do", open: false });
    expect(body.fixed).toEqual([{ fix: "Totals add up again.", fixedOn: "2026-10-21" }]);
    expect(JSON.stringify(body)).not.toContain("Aziza");
  });
});

describe("GET /api/v1/bugs/:id and its image", () => {
  it("gives the reporter their report and screenshot", async () => {
    const me = await mentor();
    const r = await bugReport({ reporterId: me.id, image: true, status: "FIXED", resolution: "Fixed it." });
    as(me);
    const body = await (await one.GET(req(), params(r.id))).json();
    expect(body).toMatchObject({ id: r.id, statusLabel: "Done", resolution: "Fixed it.", imagePath: `/api/v1/bugs/${r.id}/image` });
    expect(body.description).toBeTruthy();
    expect(body).not.toHaveProperty("reporterName");
    const shot = await image.GET(req(), params(r.id));
    expect(shot.status).toBe(200);
    expect(shot.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await shot.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("answers somebody else's report and screenshot as it answers none", async () => {
    const theirs = await bugReport({ reporterId: (await mentor("Other Mentor")).id, image: true });
    as(await mentor());
    const a = await one.GET(req(), params(theirs.id));
    const b = await one.GET(req(), params("missing"));
    expect(a.status).toBe(404);
    expect(await a.json()).toEqual(await b.json());
    expect((await image.GET(req(), params(theirs.id))).status).toBe(404);
    expect((await image.GET(req(), params("missing"))).status).toBe(404);
  });

  it("has no image address for a report with none, and its image is 404", async () => {
    const me = await mentor();
    const r = await bugReport({ reporterId: me.id });
    as(me);
    expect((await (await one.GET(req(), params(r.id))).json()).imagePath).toBeNull();
    expect((await image.GET(req(), params(r.id))).status).toBe(404);
  });

  it("lets a platform admin read anybody's", async () => {
    const r = await bugReport({ reporterId: (await mentor()).id, image: true });
    as(await platformAdmin());
    expect((await one.GET(req(), params(r.id))).status).toBe(200);
    expect((await image.GET(req(), params(r.id))).status).toBe(200);
  });
});

describe("POST /api/v1/bugs", () => {
  it("files a report with a screenshot, answers its id and tells platform admins", async () => {
    const admin = await platformAdmin();
    const me = await mentor();
    as(me);
    const res = await list.POST(report({ title: "Button missing", description: "No Save on the sheet.", from: "/evil" }, PNG_BYTES));
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, id: expect.any(String) });
    const saved = await prisma.bugReport.findUnique({ where: { id: body.id }, include: { image: true } });
    expect(saved).toMatchObject({ reporterId: me.id, title: "Button missing", pagePath: null });
    expect(saved?.image?.mimeType).toBe("image/png");
    expect(await prisma.notification.count({ where: { userId: admin.id, type: "BUG_REPORTED" } })).toBe(1);
  });

  it("files one without a screenshot", async () => {
    as(await mentor());
    const body = await (await list.POST(report({ title: "Typo", description: "Recieve." }))).json();
    expect(await prisma.bugReportImage.count({ where: { reportId: body.id } })).toBe(0);
  });

  it("names the field freshform refuses, and refuses a body that isn't multipart", async () => {
    as(await mentor());
    const res = await list.POST(report({ title: "", description: "x" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "title", error: "Give the report a short title." });
    expect((await (await list.POST(report({ title: "T", description: "" }))).json()).field).toBe("description");
    const json = new Request("http://test", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect((await list.POST(json)).status).toBe(400);
  });

  it("holds a reporter to the hourly cap, in freshform's words", async () => {
    const me = await mentor();
    for (let i = 0; i < BUG_REPORTS_PER_HOUR; i++) await bugReport({ reporterId: me.id, createdAt: new Date() });
    as(me);
    const res = await list.POST(report({ title: "One more", description: "Again." }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reports in the last hour/);
  });
});
