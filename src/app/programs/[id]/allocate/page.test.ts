import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const state = vi.hoisted(() => ({ writes: true }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("@/lib/dal", () => ({
  requireProgramScope: async () => {
    calls.push("gate");
    return { id: "u1", platformAdmin: false };
  },
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/authz", () => ({
  canManageProgram: async () => {
    calls.push("writes");
    return state.writes;
  },
  staffLevel: async () => (state.writes ? "ADMIN" : "LEADER"),
}));
vi.mock("@/app/programs/reads", () => ({
  programOf: async (id: string) => {
    calls.push("read");
    return { id, name: "Research", hourBank: false, tracksPayment: false };
  },
  programStudents: async () => [],
  programPairings: async () => [],
  studentsOf: () => [],
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { default: AllocateInProgramPage } = await import("@/app/programs/[id]/allocate/page");
const props = { params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({}) };

beforeEach(() => {
  calls.length = 0;
  state.writes = true;
});

describe("/programs/[id]/allocate", () => {
  it("draws the form for an admin of the program", async () => {
    await AllocateInProgramPage(props);
    expect(calls).toEqual(["gate", "writes", "read"]);
  });

  it("is not-found for a read-only grant, before it reads anything", async () => {
    state.writes = false;
    await expect(AllocateInProgramPage(props)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(calls).toEqual(["gate", "writes"]);
  });
});
