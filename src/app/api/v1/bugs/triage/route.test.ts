import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { bugReport, mentor, platformAdmin } from "@/test/db";

/**
 * Bug triage. What is pinned: platform admins only (anybody else the same 404
 * as no report), the reporter is told when it is Done or Won't do, and a
 * report's reporter never reads the triage fields.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const board = await import("@/app/api/v1/bugs/triage/route");
const status = await import("@/app/api/v1/bugs/[id]/status/route");
const one = await import("@/app/api/v1/bugs/[id]/route");
const getBoard = (q = "") => board.GET(new Request(`http://test/api/v1/bugs/triage${q}`));
const setStatus = (id: string, body: unknown) =>
  status.POST(new Request(`http://test/api/v1/bugs/${id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const getOne = (id: string) => one.GET(new Request(`http://test/api/v1/bugs/${id}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  actor.value = null;
});

describe("bug triage", () => {
  it("shows a platform admin the open and finished reports, and anybody else a 404", async () => {
    const reporter = await mentor("Akmal Karimov");
    await bugReport({ reporterId: reporter.id, title: "Open one" });
    await bugReport({ reporterId: reporter.id, title: "A wish", kind: "FEATURE" });
    await bugReport({ reporterId: reporter.id, title: "Done one", status: "FIXED", resolution: "Fixed.", resolvedAt: new Date() });
    actor.value = { id: reporter.id };
    expect((await getBoard()).status).toBe(404);

    actor.value = { id: (await platformAdmin()).id };
    const body = await (await getBoard()).json();
    expect(body.open.map((c: { title: string }) => c.title).sort()).toEqual(["A wish", "Open one"]);
    expect(body.open.find((c: { title: string }) => c.title === "A wish")).toMatchObject({ kind: "FEATURE", kindLabel: "Feature request", reporter: "Akmal Karimov" });
    expect(body.finished.map((c: { title: string }) => c.title)).toEqual(["Done one"]);
    expect((await (await getBoard("?kind=FEATURE")).json()).open.map((c: { title: string }) => c.title)).toEqual(["A wish"]);
  });

  it("marks a report Done with its fix line, and tells the reporter", async () => {
    const reporter = await mentor();
    const r = await bugReport({ reporterId: reporter.id });
    actor.value = { id: (await platformAdmin()).id };
    const refused = await setStatus(r.id, { status: "FIXED" });
    expect(await refused.json()).toMatchObject({ field: "resolution", error: "Write the fix line everyone will read." });
    expect(await (await setStatus(r.id, { status: "FIXED", resolution: "Totals add up again." })).json()).toMatchObject({ ok: true });
    expect(await prisma.bugReport.findUnique({ where: { id: r.id } })).toMatchObject({ status: "FIXED", resolution: "Totals add up again." });
    expect(await prisma.notification.count({ where: { userId: reporter.id, type: "BUG_FIXED" } })).toBe(1);
  });

  it("answers anybody but a platform admin, and no such report, with the same 404", async () => {
    const reporter = await mentor();
    const r = await bugReport({ reporterId: reporter.id });
    actor.value = { id: reporter.id };
    const theirs = await setStatus(r.id, { status: "CLOSED", resolution: "No." });
    actor.value = { id: (await platformAdmin()).id };
    const missing = await setStatus("nobody", { status: "CLOSED", resolution: "No." });
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect((await prisma.bugReport.findUnique({ where: { id: r.id } }))?.status).toBe("PENDING");
  });

  it("gives a platform admin a report's triage fields, and its reporter none", async () => {
    const reporter = await mentor("Akmal Karimov");
    const r = await bugReport({ reporterId: reporter.id, pagePath: "/students", originalText: "group words" });
    actor.value = { id: reporter.id };
    expect((await (await getOne(r.id)).json()).triage).toBeNull();
    actor.value = { id: (await platformAdmin()).id };
    expect((await (await getOne(r.id)).json()).triage).toMatchObject({ reporter: "Akmal Karimov", kind: "BUG", pagePath: "/students", originalText: "group words" });
  });
});
