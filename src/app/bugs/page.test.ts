import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const session = vi.hoisted(() => ({ signedIn: true }));

vi.mock("@/lib/dal", () => ({
  requireUser: async () => {
    calls.push("gate");
    if (!session.signedIn) throw new Error("redirect:/login");
    return { id: "u1", platformAdmin: false };
  },
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/bug-queries", () => ({
  myBugReports: async () => {
    calls.push("mine");
    return [];
  },
  fixedBugs: async () => {
    calls.push("fixed");
    return [];
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { default: BugsPage } = await import("@/app/bugs/page");

beforeEach(() => {
  calls.length = 0;
  session.signedIn = true;
});

describe("/bugs", () => {
  it("gates before it reads anything", async () => {
    await BugsPage();
    expect(calls[0]).toBe("gate");
    expect(calls.slice(1).sort()).toEqual(["fixed", "mine"]);
  });

  it("reads nothing for a signed-out request", async () => {
    session.signedIn = false;
    await expect(BugsPage()).rejects.toThrow("redirect:/login");
    expect(calls).toEqual(["gate"]);
  });
});
