import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { fixedBugs } from "@/lib/bug-queries";
import { admin, bugReport, mentor, platformAdmin } from "@/test/db";

const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { setBugStatus } = await import("@/lib/actions/bugs");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const reload = (id: string) => prisma.bugReport.findUniqueOrThrow({ where: { id } });

describe("setBugStatus", () => {
  it("refuses everybody who is not a platform admin, even the reporter", async () => {
    const me = await mentor("Reporter");
    const r = await bugReport({ reporterId: me.id });
    for (const who of [me, await admin(), null]) {
      actor.value = who;
      const state = await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "x" }));
      expect(state).toMatchObject({ ok: false });
    }
    expect((await reload(r.id)).status).toBe("PENDING");
  });

  it("refuses a status that is not one of the four", async () => {
    actor.value = await platformAdmin();
    const r = await bugReport();
    expect(await setBugStatus(null, form({ id: r.id, status: "DONE" }))).toMatchObject({ ok: false });
    expect((await reload(r.id)).status).toBe("PENDING");
  });

  it("refuses an unknown report", async () => {
    actor.value = await platformAdmin();
    expect(await setBugStatus(null, form({ id: "nope", status: "IN_PROGRESS" }))).toMatchObject({ ok: false });
  });

  it("moves a report to In progress without asking for words", async () => {
    actor.value = await platformAdmin();
    const r = await bugReport();
    expect(await setBugStatus(null, form({ id: r.id, status: "IN_PROGRESS" }))).toMatchObject({ ok: true });
    const row = await reload(r.id);
    expect(row.status).toBe("IN_PROGRESS");
    expect(row.resolvedAt).toBeNull();
  });

  it("will not mark a report Fixed without a fix line, and leaves it as it was", async () => {
    actor.value = await platformAdmin();
    const r = await bugReport();
    for (const resolution of ["", "   "]) {
      expect(await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution }))).toMatchObject({ ok: false, field: "resolution" });
    }
    expect((await reload(r.id)).status).toBe("PENDING");
  });

  it("will not take a fix line over 300 characters", async () => {
    actor.value = await platformAdmin();
    const r = await bugReport();
    expect(await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "x".repeat(301) }))).toMatchObject({ ok: false });
    expect((await reload(r.id)).status).toBe("PENDING");
  });

  it("marks a report Fixed, stamps it, and puts the line on the public list", async () => {
    const boss = await platformAdmin();
    actor.value = boss;
    const r = await bugReport();

    const state = await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "  Totals now add up.  ", changelogDate: "2026-10-01" }));
    expect(state).toMatchObject({ ok: true });

    const row = await reload(r.id);
    expect(row).toMatchObject({ status: "FIXED", resolution: "Totals now add up.", changelogDate: "2026-10-01", triagedById: boss.id });
    expect(row.resolvedAt).not.toBeNull();
    expect((await fixedBugs()).map((f) => f.resolution)).toEqual(["Totals now add up."]);
  });

  it("dates a fix today when no day is given, and refuses a day that is not one", async () => {
    actor.value = await platformAdmin();
    const r = await bugReport();
    expect(await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "x", changelogDate: "2026-02-31" }))).toMatchObject({ ok: false, field: "changelogDate" });
    expect(await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "x", changelogDate: "tomorrow" }))).toMatchObject({ ok: false });
    expect((await reload(r.id)).status).toBe("PENDING");

    expect(await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "x" }))).toMatchObject({ ok: true });
    expect((await reload(r.id)).changelogDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("closes only with a note, keeps it off the public list, and sets no changelog day", async () => {
    actor.value = await platformAdmin();
    const r = await bugReport();
    expect(await setBugStatus(null, form({ id: r.id, status: "CLOSED", resolution: "" }))).toMatchObject({ ok: false, field: "resolution" });

    expect(await setBugStatus(null, form({ id: r.id, status: "CLOSED", resolution: "Works as designed.", changelogDate: "2026-10-01" }))).toMatchObject({ ok: true });
    const row = await reload(r.id);
    expect(row).toMatchObject({ status: "CLOSED", resolution: "Works as designed.", changelogDate: null });
    expect(await fixedBugs()).toEqual([]);
  });

  it("reopens a report: off the public list, dates cleared, the old line kept", async () => {
    actor.value = await platformAdmin();
    const r = await bugReport({ status: "FIXED", resolution: "old fix", resolvedAt: new Date(), changelogDate: "2026-10-01" });

    expect(await setBugStatus(null, form({ id: r.id, status: "PENDING" }))).toMatchObject({ ok: true });
    const row = await reload(r.id);
    expect(row).toMatchObject({ status: "PENDING", resolvedAt: null, changelogDate: null, resolution: "old fix" });
    expect(await fixedBugs()).toEqual([]);
  });

  describe("notifications", () => {
    it("tells the reporter when it is fixed, with a link", async () => {
      const me = await mentor("Reporter");
      actor.value = await platformAdmin();
      const r = await bugReport({ reporterId: me.id });
      await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "Totals now add up." }));

      const notes = await prisma.notification.findMany({ where: { userId: me.id } });
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ type: "BUG_FIXED", href: `/bugs/${r.id}` });
      expect(notes[0].message).toContain("Totals now add up.");
    });

    it("tells the reporter when it is closed, with the note", async () => {
      const me = await mentor("Reporter");
      actor.value = await platformAdmin();
      const r = await bugReport({ reporterId: me.id, title: "Odd total" });
      await setBugStatus(null, form({ id: r.id, status: "CLOSED", resolution: "Works as designed." }));

      const [note] = await prisma.notification.findMany({ where: { userId: me.id } });
      expect(note.type).toBe("BUG_CLOSED");
      expect(note.message).toContain("Odd total");
      expect(note.message).toContain("Works as designed.");
    });

    it("stays quiet for In progress, for a reopen, for an edit to the same status, and for a removed reporter", async () => {
      const me = await mentor("Reporter");
      actor.value = await platformAdmin();
      const r = await bugReport({ reporterId: me.id });
      await setBugStatus(null, form({ id: r.id, status: "IN_PROGRESS" }));
      await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "first line" }));
      expect(await prisma.notification.count({ where: { userId: me.id } })).toBe(1);

      await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "reworded line" }));
      await setBugStatus(null, form({ id: r.id, status: "PENDING" }));
      expect(await prisma.notification.count({ where: { userId: me.id } })).toBe(1);

      const orphan = await bugReport({ reporterId: null });
      await setBugStatus(null, form({ id: orphan.id, status: "FIXED", resolution: "x" }));
      expect(await prisma.notification.count()).toBe(1);
    });

    it("does not notify a platform admin about their own report", async () => {
      const boss = await platformAdmin();
      actor.value = boss;
      const r = await bugReport({ reporterId: boss.id });
      await setBugStatus(null, form({ id: r.id, status: "FIXED", resolution: "x" }));
      expect(await prisma.notification.count()).toBe(0);
    });
  });
});
