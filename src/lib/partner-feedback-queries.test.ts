import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  partnerFeedbackWhere,
  partnerSummary,
  readPartnerFilters,
} from "@/lib/partner-feedback-queries";
import { mentor, partner } from "@/test/db";

type Row = {
  partnerId: string;
  studentEmail?: string;
  mentorId?: string;
  sessionNumber?: number;
  name?: string;
  rating: number;
  createdAt?: Date;
};

async function row(r: Row) {
  return prisma.partnerFeedback.create({
    data: {
      kind: r.mentorId ? "MENTOR" : "SESSION",
      studentEmail: "s@x.uz",
      comment: "ok",
      ...r,
    },
  });
}

describe("partnerSummary", () => {
  it("groups by mentor (worst first) and by session (ascending)", async () => {
    const p = await partner();
    const good = await mentor("Good");
    const bad = await mentor("Bad");
    await row({ partnerId: p.id, mentorId: good.id, rating: 5 });
    await row({ partnerId: p.id, mentorId: good.id, rating: 5 });
    await row({ partnerId: p.id, mentorId: bad.id, rating: 1 });
    await row({ partnerId: p.id, mentorId: bad.id, rating: 2 });
    await row({ partnerId: p.id, sessionNumber: 2, name: "Two", rating: 4 });
    await row({ partnerId: p.id, sessionNumber: 1, name: "One", rating: 3 });

    const s = await partnerSummary(p.id, {});
    expect(s.total).toBe(6);
    expect(s.average).toBeCloseTo(20 / 6);
    expect(s.byMentor.map((m) => [m.name, m.count, m.average])).toEqual([
      ["Bad", 2, 1.5],
      ["Good", 2, 5],
    ]);
    expect(s.bySession.map((x) => x.sessionNumber)).toEqual([1, 2]);
  });

  it("kind SESSION leaves no mentors", async () => {
    const p = await partner();
    const m = await mentor();
    await row({ partnerId: p.id, mentorId: m.id, rating: 5 });
    await row({ partnerId: p.id, sessionNumber: 1, name: "One", rating: 3 });
    const s = await partnerSummary(p.id, { kind: "SESSION" });
    expect(s.byMentor).toEqual([]);
    expect(s.total).toBe(1);
  });

  it("q matches name and email once each, case-insensitively", async () => {
    const p = await partner();
    const m = await mentor();
    await row({ partnerId: p.id, sessionNumber: 1, name: "Aziz", rating: 3 });
    await row({ partnerId: p.id, mentorId: m.id, studentEmail: "aziz@x.uz", rating: 4 });
    await row({ partnerId: p.id, mentorId: m.id, studentEmail: "bek@x.uz", rating: 4 });
    const s = await partnerSummary(p.id, { q: "AZ" });
    expect(s.total).toBe(2);
    expect(
      await prisma.partnerFeedback.count({
        where: partnerFeedbackWhere(p.id, { q: "AZ" }),
      })
    ).toBe(2);
  });

  it("never counts another partner's rows", async () => {
    const p = await partner();
    const other = await partner();
    const m = await mentor();
    await row({ partnerId: other.id, mentorId: m.id, rating: 1 });
    const s = await partnerSummary(p.id, {});
    expect(s).toMatchObject({
      total: 0,
      average: null,
      lastWeek: 0,
      byMentor: [],
      bySession: [],
    });
  });

  it("lastWeek counts the filtered rows from the last 7 days", async () => {
    const p = await partner();
    const now = new Date("2026-10-20T12:00:00Z");
    await row({ partnerId: p.id, sessionNumber: 1, name: "A", rating: 3, createdAt: new Date("2026-10-18T00:00:00Z") });
    await row({ partnerId: p.id, sessionNumber: 1, name: "A", rating: 3, createdAt: new Date("2026-10-01T00:00:00Z") });
    expect((await partnerSummary(p.id, {}, now)).lastWeek).toBe(1);
    expect((await partnerSummary(p.id, { rating: 5 }, now)).lastWeek).toBe(0);
  });
});

describe("readPartnerFilters", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  it("reads valid params", () => {
    expect(
      readPartnerFilters(
        { kind: "MENTOR", mentor: "m1", session: "3", rating: "4", q: " Az ", from: "2026-10-01" },
        now
      )
    ).toMatchObject({
      kind: "MENTOR",
      mentorId: "m1",
      session: 3,
      rating: 4,
      q: "Az",
      from: new Date("2026-10-01T00:00:00Z"),
    });
  });
  it("drops the unparseable", () => {
    const f = readPartnerFilters(
      { kind: "OTHER", session: "0", rating: "6", q: "", mentor: "" },
      now
    );
    expect(f.kind).toBeUndefined();
    expect(f.session).toBeUndefined();
    expect(f.rating).toBeUndefined();
    expect(f.q).toBeUndefined();
    expect(f.mentorId).toBeUndefined();
    expect(readPartnerFilters({ session: "1.5", rating: "abc" }, now)).toEqual({});
  });
});
