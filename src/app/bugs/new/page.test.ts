import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const session = vi.hoisted(() => ({ signedIn: true }));

vi.mock("@/lib/dal", () => ({
  requireUser: async () => {
    calls.push("gate");
    if (!session.signedIn) throw new Error("redirect:/login");
    return { id: "u1" };
  },
  getCurrentUser: async () => null,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { default: NewBugPage } = await import("@/app/bugs/new/page");

beforeEach(() => {
  calls.length = 0;
  session.signedIn = true;
});

describe("/bugs/new", () => {
  it("gates first, then reads the page it was opened from", async () => {
    const element = await NewBugPage({ searchParams: Promise.resolve({ from: "/mentors/abc?x=1" }) });
    expect(calls).toEqual(["gate"]);
    expect(JSON.stringify(element)).toContain("/mentors/abc");
    expect(JSON.stringify(element)).not.toContain("x=1");
  });

  it("drops a page that is not one of ours", async () => {
    const element = await NewBugPage({ searchParams: Promise.resolve({ from: "https://evil.com" }) });
    expect(JSON.stringify(element)).not.toContain("evil.com");
  });

  it("is closed to a signed-out request", async () => {
    session.signedIn = false;
    await expect(NewBugPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login");
  });
});
