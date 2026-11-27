import { beforeEach, describe, expect, it, vi } from "vitest";

/** Pay is confidential: the page gates before it reads a single rate. */
const calls = vi.hoisted(() => [] as string[]);
const session = vi.hoisted(() => ({ admin: true }));

vi.mock("@/lib/dal", () => ({
  requirePlatformAdmin: async () => {
    calls.push("gate");
    if (!session.admin) throw new Error("NEXT_NOT_FOUND");
    return { id: "boss", platformAdmin: true };
  },
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/pay-data", () => ({
  everyMentorPay: async () => {
    calls.push("read");
    return new Map();
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { default: MentorPayPage } = await import("@/app/settings/platform/pay/page");

beforeEach(() => {
  calls.length = 0;
  session.admin = true;
});

describe("/settings/platform/pay", () => {
  it("gates before it reads anybody's pay", async () => {
    await MentorPayPage();
    expect(calls).toEqual(["gate", "read"]);
  });

  it("reads nothing for anybody who is not a platform admin", async () => {
    session.admin = false;
    await expect(MentorPayPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(calls).toEqual(["gate"]);
  });
});
