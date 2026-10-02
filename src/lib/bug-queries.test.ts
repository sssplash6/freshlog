import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  bugReportFor,
  fixedBugs,
  myBugReports,
  triageList,
} from "@/lib/bug-queries";
import { admin, bugReport, mentor, platformAdmin } from "@/test/db";

const SECRET = "Aziza Karimova sees a wrong total on her page";

describe("fixedBugs", () => {
  it("lists only Fixed reports, newest fix first", async () => {
    const who = await mentor();
    await bugReport({ reporterId: who.id, status: "PENDING" });
    await bugReport({ reporterId: who.id, status: "CLOSED", resolution: "can't reproduce", resolvedAt: new Date() });
    await bugReport({ reporterId: who.id, status: "FIXED", resolution: "older fix", resolvedAt: new Date("2026-09-01T00:00:00Z"), changelogDate: "2026-09-01" });
    await bugReport({ reporterId: who.id, status: "FIXED", resolution: "newer fix", resolvedAt: new Date("2026-09-20T00:00:00Z") });

    const rows = await fixedBugs();
    expect(rows.map((r) => r.resolution)).toEqual(["newer fix", "older fix"]);
    expect(rows[1].changelogDate).toBe("2026-09-01");
  });

  it("reads nothing but the fix line, its date and its changelog link", async () => {
    const who = await mentor();
    await bugReport({
      reporterId: who.id,
      title: SECRET,
      description: SECRET,
      pagePath: "/students/secret",
      status: "FIXED",
      resolution: "Totals now add up.",
      resolvedAt: new Date(),
      image: true,
    });

    const rows = await fixedBugs();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["changelogDate", "resolution", "resolvedAt"]);
    expect(JSON.stringify(rows)).not.toContain("Aziza");
    expect(JSON.stringify(rows)).not.toContain(who.email);
  });

  it("drops a report from the list when it is reopened", async () => {
    const r = await bugReport({ status: "FIXED", resolution: "fix", resolvedAt: new Date() });
    expect(await fixedBugs()).toHaveLength(1);
    await prisma.bugReport.update({ where: { id: r.id }, data: { status: "PENDING", resolvedAt: null } });
    expect(await fixedBugs()).toHaveLength(0);
  });
});

describe("myBugReports", () => {
  it("returns only the caller's reports, every status, newest first", async () => {
    const me = await mentor("Me");
    const other = await mentor("Other");
    await bugReport({ reporterId: me.id, title: "first", createdAt: new Date("2026-09-01T00:00:00Z") });
    await bugReport({ reporterId: me.id, title: "second", status: "FIXED", resolution: "done", resolvedAt: new Date(), createdAt: new Date("2026-09-02T00:00:00Z") });
    await bugReport({ reporterId: other.id, title: "not mine" });

    const rows = await myBugReports(me.id);
    expect(rows.map((r) => r.title)).toEqual(["second", "first"]);
  });

  it("hides a leftover fix line on a report that was reopened", async () => {
    const me = await mentor();
    await bugReport({ reporterId: me.id, status: "IN_PROGRESS", resolution: "old fix line" });
    const [row] = await myBugReports(me.id);
    expect(row.resolution).toBeNull();
  });

  it("shows the reporter their Closed note", async () => {
    const me = await mentor();
    await bugReport({ reporterId: me.id, status: "CLOSED", resolution: "Works as designed.", resolvedAt: new Date() });
    const [row] = await myBugReports(me.id);
    expect(row.resolution).toBe("Works as designed.");
  });
});

describe("bugReportFor", () => {
  it("gives a reporter their own report, with no reporter name", async () => {
    const me = await mentor("Me");
    const r = await bugReport({ reporterId: me.id, title: SECRET, image: true });
    const found = await bugReportFor(me, r.id);
    expect(found?.title).toBe(SECRET);
    expect(found?.hasImage).toBe(true);
    expect(found?.reporterName).toBeNull();
  });

  it("answers somebody else's report and an unknown id the same way", async () => {
    const me = await mentor("Me");
    const other = await mentor("Other");
    const r = await bugReport({ reporterId: me.id });
    expect(await bugReportFor(other, r.id)).toBeNull();
    expect(await bugReportFor(other, "no-such-id")).toBeNull();
  });

  it("gives a platform admin any report, with the reporter's name", async () => {
    const me = await mentor("Dilnoza");
    const boss = await platformAdmin();
    const r = await bugReport({ reporterId: me.id, status: "IN_PROGRESS", resolution: "earlier note" });
    const found = await bugReportFor(boss, r.id);
    expect(found?.reporterName).toBe("Dilnoza");
    expect(found?.resolution).toBe("earlier note");
  });

  it("does not make a program admin a triager", async () => {
    const me = await mentor("Me");
    const programAdmin = await admin();
    const r = await bugReport({ reporterId: me.id });
    expect(await bugReportFor(programAdmin, r.id)).toBeNull();
  });

  it("survives a reporter whose account was removed", async () => {
    const gone = await mentor("Gone");
    const boss = await platformAdmin();
    const r = await bugReport({ reporterId: gone.id });
    await prisma.user.delete({ where: { id: gone.id } });

    const found = await bugReportFor(boss, r.id);
    expect(found).not.toBeNull();
    expect(found?.reporterName).toBe("Former user");
    const [row] = await triageList(boss, "all");
    expect(row.reporterName).toBe("Former user");
  });
});

describe("triageList", () => {
  it("is empty for anybody who is not a platform admin", async () => {
    await bugReport();
    expect(await triageList(await admin(), "all")).toEqual([]);
    expect(await triageList(await mentor(), "open")).toEqual([]);
  });

  it("opens on Pending and In progress, and filters by status", async () => {
    const boss = await platformAdmin();
    await bugReport({ title: "p", status: "PENDING" });
    await bugReport({ title: "w", status: "IN_PROGRESS" });
    await bugReport({ title: "f", status: "FIXED", resolution: "x", resolvedAt: new Date() });
    await bugReport({ title: "c", status: "CLOSED", resolution: "y", resolvedAt: new Date() });

    expect((await triageList(boss, "open")).map((r) => r.title).sort()).toEqual(["p", "w"]);
    expect((await triageList(boss, "FIXED")).map((r) => r.title)).toEqual(["f"]);
    expect(await triageList(boss, "all")).toHaveLength(4);
  });
});
