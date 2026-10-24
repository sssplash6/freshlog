import { describe, expect, it } from "vitest";

import { mayDismiss, statusKeyFrom } from "@/lib/api/v1/dismissals";
import { prisma } from "@/lib/prisma";
import { admin, mentor, platformAdmin, program, student } from "@/test/db";

async function userOf(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id } });
}

describe("statusKeyFrom", () => {
  it("takes a type the status model makes, and a subjectId as text, \"\" allowed", () => {
    expect(statusKeyFrom({ type: "BALANCE_NONE", subjectId: "abc" })).toEqual({ type: "BALANCE_NONE", subjectId: "abc" });
    expect(statusKeyFrom({ type: "GOOGLE_RECONNECT", subjectId: "" })).toEqual({ type: "GOOGLE_RECONNECT", subjectId: "" });
  });

  it("\"NOT_A_TYPE\" is refused with field \"type\"; so is a type that isn't text", () => {
    expect(statusKeyFrom({ type: "NOT_A_TYPE", subjectId: "" })).toEqual({ field: "type" });
    expect(statusKeyFrom({ type: 5, subjectId: "" })).toEqual({ field: "type" });
    expect(statusKeyFrom({ subjectId: "" })).toEqual({ field: "type" });
  });

  it("a subjectId that isn't text is refused with field \"subjectId\", and a missing one is too", () => {
    expect(statusKeyFrom({ type: "BALANCE_NONE", subjectId: 7 })).toEqual({ field: "subjectId" });
    expect(statusKeyFrom({ type: "BALANCE_NONE", subjectId: null })).toEqual({ field: "subjectId" });
    expect(statusKeyFrom({ type: "BALANCE_NONE" })).toEqual({ field: "subjectId" });
  });
});

describe("mayDismiss", () => {
  it("a mentor and an admin may; a student may not; a student who mentors may", async () => {
    const m = await mentor("Akmal Karimov");
    const a = await admin("Ada Admin");
    const pa = await platformAdmin();
    const s = await student({ name: "Aziz Tursunov" });
    const sm = await student({ name: "Both Roles", programId: (await program("Other Program")).id });
    await prisma.user.update({ where: { id: sm.userId }, data: { isMentor: true } });
    expect(await mayDismiss(await userOf(m.id))).toBe(true);
    expect(await mayDismiss(await userOf(a.id))).toBe(true);
    expect(await mayDismiss(await userOf(pa.id))).toBe(true);
    expect(await mayDismiss(await userOf(s.userId))).toBe(false);
    expect(await mayDismiss(await userOf(sm.userId))).toBe(true);
  });
});
