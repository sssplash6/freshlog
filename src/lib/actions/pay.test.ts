import { beforeEach, describe, expect, it, vi } from "vitest";

import { ROLES } from "@/lib/constants";
import { toDateInputValue } from "@/lib/format";
import { parseDollarsPerHour, rateDayBounds } from "@/lib/pay";
import { prisma } from "@/lib/prisma";
import { admin, grant, mentor, platformAdmin, program, student } from "@/test/db";
import { programToday } from "@/lib/when";

const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { setMentorRate } = await import("@/lib/actions/pay");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

/** A day `n` days from Tashkent's today, as `YYYY-MM-DD`. */
function todayPlus(n: number): string {
  const t = new Date(`${programToday()}T00:00:00.000Z`);
  return toDateInputValue(new Date(t.getTime() + n * 86_400_000));
}

const { min: FIRST_OF_MONTH, max: A_YEAR_ON } = rateDayBounds();

async function asPlatformAdmin() {
  const boss = await platformAdmin();
  actor.value = { id: boss.id };
  return boss;
}

beforeEach(() => {
  actor.value = null;
});

describe("setMentorRate — who may", () => {
  it("lets a platform admin add a rate, as a new row with their name on it", async () => {
    const boss = await asPlatformAdmin();
    const m = await mentor("Malika Karimova");
    const res = await setMentorRate(null, form({ mentorId: m.id, dollarsPerHour: "22.50", effectiveFrom: FIRST_OF_MONTH }));
    expect(res).toMatchObject({ ok: true });
    expect(res?.ok && res.message).toContain("Malika Karimova: $22.50/h from");
    const rows = await prisma.mentorPayRate.findMany({ where: { mentorId: m.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ centsPerHour: 2250, createdById: boss.id, effectiveFrom: new Date(`${FIRST_OF_MONTH}T00:00:00.000Z`) });
  });

  it("refuses anybody signed out", async () => {
    const m = await mentor();
    const res = await setMentorRate(null, form({ mentorId: m.id, dollarsPerHour: "20", effectiveFrom: FIRST_OF_MONTH }));
    expect(res).toMatchObject({ ok: false });
    expect(await prisma.mentorPayRate.count()).toBe(0);
  });

  it("refuses a program admin, a mentor (their own rate included) and a student", async () => {
    const p = await program();
    const progAdmin = await admin();
    await grant({ userId: progAdmin.id, programId: p.id });
    const m = await mentor();
    const s = await student({ programId: p.id });
    for (const who of [progAdmin.id, m.id, s.userId]) {
      actor.value = { id: who };
      const res = await setMentorRate(null, form({ mentorId: m.id, dollarsPerHour: "20", effectiveFrom: FIRST_OF_MONTH }));
      expect(res).toEqual({ ok: false, error: "Only a platform admin can do that." });
    }
    expect(await prisma.mentorPayRate.count()).toBe(0);
  });
});

describe("setMentorRate — whom", () => {
  it("refuses somebody who cannot mentor, and an id that does not exist", async () => {
    await asPlatformAdmin();
    const plainAdmin = await admin();
    const s = await student();
    for (const mentorId of [plainAdmin.id, s.userId, "nope", ""]) {
      const res = await setMentorRate(null, form({ mentorId, dollarsPerHour: "20", effectiveFrom: FIRST_OF_MONTH }));
      expect(res).toMatchObject({ ok: false, field: "mentorId" });
    }
    expect(await prisma.mentorPayRate.count()).toBe(0);
  });

  it("accepts an admin or a student who is flagged as a mentor", async () => {
    await asPlatformAdmin();
    const dual = await prisma.user.create({ data: { email: "dual@test.invalid", name: "Dual Role", role: ROLES.ADMIN, isMentor: true } });
    const res = await setMentorRate(null, form({ mentorId: dual.id, dollarsPerHour: "20", effectiveFrom: FIRST_OF_MONTH }));
    expect(res).toMatchObject({ ok: true });
  });
});

describe("setMentorRate — the amount", () => {
  it.each([
    ["0", 0],
    ["20", 2000],
    ["20.5", 2050],
    ["20.05", 2005],
    ["$25", 2500],
    [" 1000 ", 100000],
    ["1000.00", 100000],
    ["0.01", 1],
  ])("stores %s as %i cents", async (typed, cents) => {
    await asPlatformAdmin();
    const m = await mentor();
    const res = await setMentorRate(null, form({ mentorId: m.id, dollarsPerHour: typed, effectiveFrom: FIRST_OF_MONTH }));
    expect(res).toMatchObject({ ok: true });
    expect((await prisma.mentorPayRate.findFirstOrThrow({ where: { mentorId: m.id } })).centsPerHour).toBe(cents);
  });

  it.each(["", "abc", "-5", "20.555", "1000.01", "5000", "1e3", "1,000", "20.", ".5", "Infinity", "NaN", "20 50"])(
    "refuses %j",
    async (typed) => {
      await asPlatformAdmin();
      const m = await mentor();
      const res = await setMentorRate(null, form({ mentorId: m.id, dollarsPerHour: typed, effectiveFrom: FIRST_OF_MONTH }));
      expect(res).toMatchObject({ ok: false, field: "dollarsPerHour" });
      // A failed form refills itself with what was typed.
      expect(res && !res.ok && res.values?.dollarsPerHour).toBe(typed);
      expect(await prisma.mentorPayRate.count()).toBe(0);
    }
  );

  it("parses without floats: 0.29 is 29 cents, not 28.999…", () => {
    expect(parseDollarsPerHour("0.29")).toEqual({ value: 29 });
    expect(parseDollarsPerHour("19.99")).toEqual({ value: 1999 });
  });
});

describe("setMentorRate — the day", () => {
  it("accepts the first of this month, today, and a year from today", async () => {
    await asPlatformAdmin();
    const m = await mentor();
    for (const d of [FIRST_OF_MONTH, programToday(), A_YEAR_ON]) {
      const res = await setMentorRate(null, form({ mentorId: m.id, dollarsPerHour: "20", effectiveFrom: d }));
      expect(res, d).toMatchObject({ ok: true });
    }
    expect(await prisma.mentorPayRate.count()).toBe(3);
  });

  it("refuses the day before the first of this month: last month may be paid", async () => {
    await asPlatformAdmin();
    const m = await mentor();
    const lastDayOfLastMonth = toDateInputValue(new Date(new Date(`${FIRST_OF_MONTH}T00:00:00.000Z`).getTime() - 86_400_000));
    const res = await setMentorRate(null, form({ mentorId: m.id, dollarsPerHour: "20", effectiveFrom: lastDayOfLastMonth }));
    expect(res).toMatchObject({ ok: false, field: "effectiveFrom" });
    expect(res && !res.ok && res.error).toContain("no earlier than");
  });

  it("refuses a day more than a year ahead", async () => {
    await asPlatformAdmin();
    const m = await mentor();
    const tooFar = toDateInputValue(new Date(new Date(`${A_YEAR_ON}T00:00:00.000Z`).getTime() + 86_400_000));
    const res = await setMentorRate(null, form({ mentorId: m.id, dollarsPerHour: "20", effectiveFrom: tooFar }));
    expect(res).toMatchObject({ ok: false, field: "effectiveFrom" });
    expect(res && !res.ok && res.error).toContain("a year ahead");
  });

  it.each(["", "tomorrow", "2026-02-31", "2026-13-01", "26-12-01", "2026-12-01T00:00"])("refuses %j as a day", async (d) => {
    await asPlatformAdmin();
    const m = await mentor();
    const res = await setMentorRate(null, form({ mentorId: m.id, dollarsPerHour: "20", effectiveFrom: d }));
    expect(res).toMatchObject({ ok: false, field: "effectiveFrom" });
  });

  it("stores the day at UTC midnight, the way a session's date is stored", async () => {
    await asPlatformAdmin();
    const m = await mentor();
    const d = todayPlus(3) <= A_YEAR_ON ? todayPlus(3) : programToday();
    await setMentorRate(null, form({ mentorId: m.id, dollarsPerHour: "20", effectiveFrom: d }));
    const row = await prisma.mentorPayRate.findFirstOrThrow({ where: { mentorId: m.id } });
    expect(row.effectiveFrom.toISOString()).toBe(`${d}T00:00:00.000Z`);
  });
});

describe("setMentorRate — append-only", () => {
  it("never changes an earlier row: a second rate on the same day is a new row", async () => {
    await asPlatformAdmin();
    const m = await mentor();
    await setMentorRate(null, form({ mentorId: m.id, dollarsPerHour: "200", effectiveFrom: FIRST_OF_MONTH }));
    const first = await prisma.mentorPayRate.findFirstOrThrow({ where: { mentorId: m.id } });
    await setMentorRate(null, form({ mentorId: m.id, dollarsPerHour: "20", effectiveFrom: FIRST_OF_MONTH }));
    const rows = await prisma.mentorPayRate.findMany({ where: { mentorId: m.id } });
    expect(rows.map((r) => r.centsPerHour).sort((a, b) => b - a)).toEqual([20000, 2000]);
    expect(rows.find((r) => r.id === first.id)).toEqual(first);
  });
});

describe("rateDayBounds", () => {
  it("runs from the first of Tashkent's month to a year on, by Tashkent's clock", () => {
    // 21:00 UTC on 31 December is already 1 January in Tashkent.
    expect(rateDayBounds(new Date("2026-12-31T21:00:00.000Z"))).toEqual({ min: "2027-01-01", max: "2028-01-01" });
    expect(rateDayBounds(new Date("2026-12-31T18:59:00.000Z"))).toEqual({ min: "2026-12-01", max: "2027-12-31" });
    expect(rateDayBounds(new Date("2028-02-29T12:00:00.000Z"))).toEqual({ min: "2028-02-01", max: "2029-03-01" });
  });
});
