import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const session = vi.hoisted(() => ({ signedIn: true }));

vi.mock("@/lib/dal", () => ({
  requireUser: async () => {
    calls.push("gate");
    if (!session.signedIn) throw new Error("redirect:/login");
    return { id: "u1", createdAt: new Date("2026-01-01T00:00:00Z"), changelogSeenAt: null };
  },
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/changelog", async (original) => ({
  ...(await original<typeof import("@/lib/changelog")>()),
  readChangelog: async () => {
    calls.push("read");
    return [{ date: "2026-10-02", new: ["Something new"], fixed: [] }];
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { default: ChangelogPage } = await import("@/app/changelog/page");

beforeEach(() => {
  calls.length = 0;
  session.signedIn = true;
});

describe("/changelog", () => {
  it("gates before it reads anything", async () => {
    await ChangelogPage();
    expect(calls).toEqual(["gate", "read"]);
  });

  it("never reaches the file for a signed-out request", async () => {
    session.signedIn = false;
    await expect(ChangelogPage()).rejects.toThrow("redirect:/login");
    expect(calls).toEqual(["gate"]);
  });
});
