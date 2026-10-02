import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const state = vi.hoisted(() => ({ signedIn: true, report: null as null | Record<string, unknown> }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("@/lib/dal", () => ({
  requireUser: async () => {
    calls.push("gate");
    if (!state.signedIn) throw new Error("redirect:/login");
    return { id: "u1", platformAdmin: false };
  },
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/bug-queries", () => ({
  bugReportFor: async () => {
    calls.push("read");
    return state.report;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { default: BugPage } = await import("@/app/bugs/[id]/page");
const props = { params: Promise.resolve({ id: "r1" }) };

beforeEach(() => {
  calls.length = 0;
  state.signedIn = true;
  state.report = null;
});

describe("/bugs/[id]", () => {
  it("gates before it reads the report", async () => {
    state.report = {
      id: "r1", title: "t", description: "d", pagePath: null, reporterRole: "STUDENT",
      status: "PENDING", resolution: null, resolvedAt: null, changelogDate: null,
      createdAt: new Date(), hasImage: false, reporterName: null,
    };
    await BugPage(props);
    expect(calls).toEqual(["gate", "read"]);
  });

  it("reads nothing for a signed-out request", async () => {
    state.signedIn = false;
    await expect(BugPage(props)).rejects.toThrow("redirect:/login");
    expect(calls).toEqual(["gate"]);
  });

  it("is not-found when the viewer may not have it, whatever the reason", async () => {
    state.report = null;
    await expect(BugPage(props)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
