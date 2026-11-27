import { beforeEach, describe, expect, it, vi } from "vitest";

/** A mentor's pay page reads the signed-in mentor's pay, and nobody else's. */
const calls = vi.hoisted(() => [] as string[]);
const session = vi.hoisted(() => ({ mentorId: "m-1" as string | null }));

vi.mock("@/lib/dal", () => ({
  requireMentorAccess: async () => {
    calls.push("gate");
    if (!session.mentorId) throw new Error("NEXT_REDIRECT");
    return { id: session.mentorId, role: "MENTOR" };
  },
}));
vi.mock("@/lib/pay-data", () => ({
  mentorPay: async (id: string) => {
    calls.push(`read:${id}`);
    return { rates: [], payable: [] };
  },
}));

const { default: MyPayPage } = await import("@/app/mentor/pay/page");

beforeEach(() => {
  calls.length = 0;
  session.mentorId = "m-1";
});

describe("/mentor/pay", () => {
  it("gates first, then reads the signed-in mentor's own pay", async () => {
    await MyPayPage();
    expect(calls).toEqual(["gate", "read:m-1"]);
  });

  it("reads nothing for somebody who cannot mentor", async () => {
    session.mentorId = null;
    await expect(MyPayPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(calls).toEqual(["gate"]);
  });
});
