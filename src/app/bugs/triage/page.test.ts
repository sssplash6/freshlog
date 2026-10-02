import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/bug-queries", () => ({
  triageList: async () => {
    calls.push("read");
    return [];
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { default: TriagePage } = await import("@/app/bugs/triage/page");

beforeEach(() => {
  calls.length = 0;
  session.admin = true;
});

describe("/bugs/triage", () => {
  it("gates before it reads the list", async () => {
    await TriagePage({ searchParams: Promise.resolve({}) });
    expect(calls).toEqual(["gate", "read"]);
  });

  it("reads nothing for anybody who is not a platform admin", async () => {
    session.admin = false;
    await expect(TriagePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(calls).toEqual(["gate"]);
  });
});
