import { afterEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { BUG_REPORTS_PER_HOUR, BUG_SHOT_MAX_BYTES } from "@/lib/bugs";
import { bugReport, mentor, PNG_BYTES, platformAdmin } from "@/test/db";

const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { reportBug, reportOnScreen } = await import("@/lib/actions/bugs");

function form(fields: Record<string, string | File>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

/**
 * A report that saves ends in a redirect to its own page, so success arrives as
 * a thrown NEXT_REDIRECT whose digest names the target. Anything else is the
 * action's returned state — a refusal.
 */
async function submit(data: FormData) {
  try {
    return { state: await reportBug(null, data), id: null as string | null };
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? "");
    const id = /^NEXT_REDIRECT;[^;]*;\/bugs\/([^;]+);/.exec(digest)?.[1];
    if (!id) throw error;
    return { state: null, id };
  }
}

const png = () => new File([PNG_BYTES], "shot.png", { type: "image/png" });
const valid = { title: "Totals are wrong", description: "I logged 4h and it says 3h." };

describe("reportBug", () => {
  it("saves the report, snapshots the role, and tells every platform admin", async () => {
    const me = await mentor("Dilnoza");
    const boss = await platformAdmin();
    const second = await platformAdmin("Second Boss");
    actor.value = me;

    const { id } = await submit(form({ ...valid, title: "  Totals are wrong  ", from: "/mentors/abc?x=1" }));

    if (!id) throw new Error("expected a redirect to the new report");
    const row = await prisma.bugReport.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      reporterId: me.id,
      reporterRole: "MENTOR",
      title: "Totals are wrong",
      description: valid.description,
      pagePath: "/mentors/abc",
      status: "PENDING",
    });

    const notes = await prisma.notification.findMany({ where: { type: "BUG_REPORTED" } });
    expect(notes.map((n) => n.userId).sort()).toEqual([boss.id, second.id].sort());
    expect(notes[0].href).toBe(`/bugs/${row.id}`);
    expect(notes.some((n) => n.userId === me.id)).toBe(false);
  });

  it("does not notify a platform admin about their own report", async () => {
    const boss = await platformAdmin();
    actor.value = boss;
    await submit(form(valid));
    expect(await prisma.notification.count()).toBe(0);
  });

  it("refuses a missing or overlong title and description, saving nothing", async () => {
    actor.value = await mentor();
    const cases: [Record<string, string>, string][] = [
      [{ title: "  ", description: "x" }, "title"],
      [{ title: "t".repeat(121), description: "x" }, "title"],
      [{ title: "t", description: "" }, "description"],
      [{ title: "t", description: "d".repeat(2001) }, "description"],
    ];
    for (const [fields, field] of cases) {
      const { state } = await submit(form(fields));
      expect(state).toMatchObject({ ok: false, field });
    }
    expect(await prisma.bugReport.count()).toBe(0);
  });

  it("hands back what was typed so a failed form can refill", async () => {
    actor.value = await mentor();
    const { state } = await submit(form({ title: "kept", description: "" }));
    expect(state).toMatchObject({ ok: false, values: { title: "kept" } });
  });

  it("refuses when signed out", async () => {
    actor.value = null;
    expect((await submit(form(valid))).state).toMatchObject({ ok: false });
    expect(await prisma.bugReport.count()).toBe(0);
  });

  it("drops a page that is not one of our own paths and still saves the report", async () => {
    actor.value = await mentor();
    for (const from of ["https://evil.com", "//evil.com", "/\\evil.com", "/" + "a".repeat(300)]) {
      const { id } = await submit(form({ ...valid, from }));
      expect(id, from).not.toBeNull();
    }
    const rows = await prisma.bugReport.findMany();
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.pagePath === null)).toBe(true);
  });

  describe("screenshot", () => {
    it("stores a real image", async () => {
      actor.value = await mentor();
      const { id } = await submit(form({ ...valid, screenshot: png() }));
      if (!id) throw new Error("expected a redirect to the new report");
      const image = await prisma.bugReportImage.findUniqueOrThrow({ where: { reportId: id } });
      expect(image.mimeType).toBe("image/png");
    });

    it("stores no image row when none was attached", async () => {
      actor.value = await mentor();
      await submit(form(valid));
      expect(await prisma.bugReportImage.count()).toBe(0);
    });

    it("refuses a file labelled image/png whose bytes are HTML, saving nothing", async () => {
      actor.value = await mentor();
      const fake = new File(["<script>alert(1)</script>"], "x.png", { type: "image/png" });
      const { state } = await submit(form({ ...valid, screenshot: fake }));
      expect(state).toMatchObject({ ok: false });
      expect(await prisma.bugReport.count()).toBe(0);
      expect(await prisma.bugReportImage.count()).toBe(0);
    });

    it("refuses a screenshot over the size cap", async () => {
      actor.value = await mentor();
      const big = new Uint8Array(BUG_SHOT_MAX_BYTES + 1);
      big.set(PNG_BYTES);
      const { state } = await submit(form({ ...valid, screenshot: new File([big], "big.png", { type: "image/png" }) }));
      expect(state).toMatchObject({ ok: false });
      expect(await prisma.bugReport.count()).toBe(0);
    });
  });

  describe("the hourly cap", () => {
    it("refuses the sixth report in an hour", async () => {
      actor.value = await mentor();
      for (let i = 0; i < BUG_REPORTS_PER_HOUR; i++) {
        expect((await submit(form(valid))).id).not.toBeNull();
      }
      const sixth = await submit(form({ title: "one more", description: "x" }));
      expect(sixth.state).toMatchObject({ ok: false });
      expect(await prisma.bugReport.count()).toBe(BUG_REPORTS_PER_HOUR);
    });

    it("does not count reports older than an hour, or anybody else's", async () => {
      const me = await mentor("Me");
      const other = await mentor("Other");
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      for (let i = 0; i < BUG_REPORTS_PER_HOUR; i++) {
        await bugReport({ reporterId: me.id, createdAt: twoHoursAgo });
        await bugReport({ reporterId: other.id });
      }
      actor.value = me;
      expect((await submit(form(valid))).id).not.toBeNull();
    });

    it("cannot be beaten by sending them all at once", async () => {
      actor.value = await mentor();
      const results = await Promise.all(
        Array.from({ length: BUG_REPORTS_PER_HOUR + 2 }, () => submit(form(valid)))
      );
      expect(results.filter((r) => r.id)).toHaveLength(BUG_REPORTS_PER_HOUR);
      expect(await prisma.bugReport.count()).toBe(BUG_REPORTS_PER_HOUR);
    });
  });
});

describe("reportOnScreen", () => {
  const MAC_CHROME =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  const onScreen = (fields: Record<string, string | File>) => reportOnScreen(null, form(fields));
  const shot = () => ({ caption: "Make this card bigger\nit is tiny", screenshot: png(), from: "/students/abc?x=1" });
  const filedId = (state: Awaited<ReturnType<typeof onScreen>>) => {
    if (!state?.ok) throw new Error(`expected a filed report, got ${JSON.stringify(state)}`);
    return state.id;
  };

  afterEach(() => vi.unstubAllEnvs());

  it("files the caption as title and description, with the image and page, and tells the platform admins", async () => {
    const me = await mentor("Dilnoza");
    const boss = await platformAdmin();
    const second = await platformAdmin("Second Boss");
    actor.value = me;

    const id = filedId(await onScreen(shot()));

    const row = await prisma.bugReport.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      reporterId: me.id,
      reporterRole: "MENTOR",
      title: "Make this card bigger",
      description: "Make this card bigger\nit is tiny",
      pagePath: "/students/abc",
      kind: "BUG",
      source: "APP",
    });
    expect(await prisma.bugReportImage.count({ where: { reportId: id } })).toBe(1);
    const notes = await prisma.notification.findMany({ where: { type: "BUG_REPORTED" } });
    expect(notes.map((n) => n.userId).sort()).toEqual([boss.id, second.id].sort());
    expect(notes[0].href).toBe(`/bugs/${id}`);
  });

  it("stores good diagnostics", async () => {
    actor.value = await mentor();
    const id = filedId(
      await onScreen({ ...shot(), width: "1061", height: "1084", ratio: "2", theme: "dark", userAgent: MAC_CHROME, marks: "2" })
    );
    expect(await prisma.bugReport.findUniqueOrThrow({ where: { id } })).toMatchObject({
      viewport: "1061×1084 @2x",
      theme: "dark",
      userAgent: MAC_CHROME,
      marks: 2,
    });
  });

  it("drops bad diagnostics and still files the report", async () => {
    actor.value = await mentor();
    const id = filedId(await onScreen({ ...shot(), theme: "sepia", marks: "9999", width: "abc", height: "900", ratio: "1" }));
    expect(await prisma.bugReport.findUniqueOrThrow({ where: { id } })).toMatchObject({
      theme: null,
      marks: null,
      viewport: null,
    });
  });

  it("takes the build from the environment, never from the form", async () => {
    vi.stubEnv("RENDER_GIT_COMMIT", "f249b1f0c2d4e5");
    actor.value = await mentor();
    const id = filedId(await onScreen({ ...shot(), build: "deadbee" }));
    expect((await prisma.bugReport.findUniqueOrThrow({ where: { id } })).build).toBe("f249b1f");
  });

  it("refuses a signed-out call", async () => {
    actor.value = null;
    expect(await onScreen(shot())).toEqual({ ok: false, error: "Sign in to do that." });
    expect(await prisma.bugReport.count()).toBe(0);
  });

  it.each(["", "  \n \n"])("refuses an empty caption: %j", async (caption) => {
    actor.value = await mentor();
    expect(await onScreen({ ...shot(), caption })).toEqual({
      ok: false,
      field: "caption",
      error: "Say what should change.",
    });
    expect(await prisma.bugReport.count()).toBe(0);
  });

  it("refuses a caption over 2000 characters", async () => {
    actor.value = await mentor();
    expect(await onScreen({ ...shot(), caption: "c".repeat(2001) })).toMatchObject({ ok: false, field: "caption" });
    expect(await prisma.bugReport.count()).toBe(0);
  });

  it("refuses a report with no image", async () => {
    actor.value = await mentor();
    expect(await onScreen({ caption: "Make this card bigger" })).toMatchObject({ ok: false });
    expect(await prisma.bugReport.count()).toBe(0);
  });

  it("refuses a file labelled PNG whose bytes are HTML", async () => {
    actor.value = await mentor();
    const fake = new File(["<script>alert(1)</script>"], "x.png", { type: "image/png" });
    expect(await onScreen({ ...shot(), screenshot: fake })).toMatchObject({ ok: false });
    expect(await prisma.bugReport.count()).toBe(0);
    expect(await prisma.bugReportImage.count()).toBe(0);
  });

  it("shares the hourly cap with the form", async () => {
    actor.value = await mentor();
    for (let i = 0; i < 3; i++) expect((await submit(form(valid))).id).not.toBeNull();
    for (let i = 0; i < 2; i++) filedId(await onScreen(shot()));
    expect(await onScreen(shot())).toMatchObject({ ok: false });
    expect(await prisma.bugReport.count()).toBe(BUG_REPORTS_PER_HOUR);
  });
});
