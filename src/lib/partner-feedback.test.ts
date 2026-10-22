import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  normalizeSlug,
  parseEmailList,
  parseFeedback,
  passCookieName,
  readPass,
  signPass,
} from "@/lib/partner-feedback";

const NOW = new Date("2026-10-22T09:00:00Z");

// The secret is not part of the vitest environment; a pass cannot be signed
// without one.
beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-for-partner-passes");
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

describe("passCookieName", () => {
  it("is scoped to the partner", () => {
    expect(passCookieName("khana")).toBe("pf_khana");
  });
});

describe("signPass", () => {
  it("expires twelve hours on", () => {
    expect(signPass("khana", "a@b.uz", NOW).expires.getTime()).toBe(NOW.getTime() + 12 * 3600e3);
  });
});

describe("readPass", () => {
  it("returns the email for a fresh pass", () => {
    const { value } = signPass("khana", "a@b.uz", NOW);
    expect(readPass("khana", value, NOW)).toBe("a@b.uz");
  });
  it("refuses another partner's pass", () => {
    expect(readPass("other", signPass("khana", "a@b.uz", NOW).value, NOW)).toBeNull();
  });
  it("refuses a pass 12 hours and one second old", () => {
    const { value } = signPass("khana", "a@b.uz", NOW);
    expect(readPass("khana", value, new Date(NOW.getTime() + 12 * 3600e3 + 1000))).toBeNull();
  });
  it("refuses a pass whose email was swapped", () => {
    const [, exp, mac] = signPass("khana", "a@b.uz", NOW).value.split(".");
    const forged = `${Buffer.from("c@d.uz").toString("base64url")}.${exp}.${mac}`;
    expect(readPass("khana", forged, NOW)).toBeNull();
  });
  it("refuses a pass whose expiry was extended", () => {
    const [who, exp, mac] = signPass("khana", "a@b.uz", NOW).value.split(".");
    const forged = `${who}.${Number(exp) + 86400e3}.${mac}`;
    expect(readPass("khana", forged, NOW)).toBeNull();
  });
  it.each([undefined, "", "garbage", "a.b", "a.b.c.d"])("refuses %s", (v) => {
    expect(readPass("khana", v, NOW)).toBeNull();
  });
});

describe("parseFeedback", () => {
  it("accepts a mentor rating", () => {
    expect(parseFeedback("MENTOR", form({ mentorId: "m1", rating: "4", comment: " Clear " }))).toEqual({
      ok: true,
      value: { kind: "MENTOR", mentorId: "m1", rating: 4, comment: "Clear" },
    });
  });
  it("accepts a session rating", () => {
    expect(
      parseFeedback("SESSION", form({ sessionNumber: "7", name: " Aziz ", rating: "5", comment: "Good" })),
    ).toEqual({
      ok: true,
      value: { kind: "SESSION", sessionNumber: 7, name: "Aziz", rating: 5, comment: "Good" },
    });
  });
  it.each([
    ["MENTOR", { mentorId: "", rating: "4", comment: "x" }, "mentorId"],
    ["MENTOR", { mentorId: "m", rating: "0", comment: "x" }, "rating"],
    ["MENTOR", { mentorId: "m", rating: "6", comment: "x" }, "rating"],
    ["MENTOR", { mentorId: "m", rating: "4", comment: "   " }, "comment"],
    ["MENTOR", { mentorId: "m", rating: "4", comment: "x".repeat(2001) }, "comment"],
    ["SESSION", { sessionNumber: "", name: "A", rating: "4", comment: "x" }, "sessionNumber"],
    ["SESSION", { sessionNumber: "1.5", name: "A", rating: "4", comment: "x" }, "sessionNumber"],
    ["SESSION", { sessionNumber: "1000", name: "A", rating: "4", comment: "x" }, "sessionNumber"],
    ["SESSION", { sessionNumber: "3", name: " ", rating: "4", comment: "x" }, "name"],
  ] as const)("%s %o refuses on %s", (kind, fields, field) => {
    expect(parseFeedback(kind, form(fields))).toMatchObject({ ok: false, field });
  });
  it("uses the spec copy for a missing mentor", () => {
    expect(parseFeedback("MENTOR", form({ rating: "4", comment: "x" }))).toEqual({
      ok: false,
      field: "mentorId",
      error: "Pick one of the listed mentors.",
    });
  });
  it("accepts a comment of exactly 2000 characters", () => {
    expect(
      parseFeedback("MENTOR", form({ mentorId: "m", rating: "3", comment: "x".repeat(2000) })),
    ).toMatchObject({ ok: true });
  });
});

describe("parseEmailList", () => {
  it("normalizes, de-duplicates and separates the invalid", () => {
    expect(parseEmailList(" A@x.uz\na@x.uz, b@x.uz;\n\nbob@ \tc@x.uz")).toEqual({
      emails: ["a@x.uz", "b@x.uz", "c@x.uz"],
      invalid: ["bob@"],
    });
  });
});

describe("normalizeSlug", () => {
  it.each([
    [" Khana ", "khana"],
    ["sat-2026", "sat-2026"],
    ["a", null],
    ["kh ana", null],
    ["-k", null],
    ["k".repeat(41), null],
  ])("%s → %s", (raw, out) => expect(normalizeSlug(raw)).toBe(out));
});
