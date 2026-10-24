import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { mentor, pairing, program, student, studentTask } from "@/test/db";

/**
 * One student's work, to the staff who may read them. Anybody else's answers
 * exactly like a student who was never made.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/students/[id]/work/route");

const get = (id: string) => GET(new Request("http://test"), { params: Promise.resolve({ id }) });

async function setUp() {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id, name: "Aziz Karimov" });
  const m = await mentor("Akmal Karimov");
  await pairing({ mentorId: m.id, programId: p.id });
  const t = await studentTask({ studentId: st.id, mentorId: m.id });
  return { p, st, m, t };
}

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/students/:id/work", () => {
  it("answers 401 with no user", async () => expect((await get("x")).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    const { st, m } = await setUp();
    await prisma.user.update({ where: { id: m.id }, data: { status: "SUSPENDED" } });
    actor.value = { id: m.id };
    const res = await get(st.id);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("a student nobody here reaches answers like a missing one", async () => {
    const { st } = await setUp();
    const stranger = await mentor("Nobody");
    actor.value = { id: stranger.id };
    const theirs = await get(st.id);
    const missing = await get("c-made-up");
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
  });

  it("answers the mentor with the student's work", async () => {
    const { p, st, m, t } = await setUp();
    actor.value = { id: m.id };
    const res = await get(st.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      student: { id: st.id },
      tasks: [{ id: t.id, can: { edit: true } }],
      plan: [],
      canSetTaskIn: [{ id: p.id, name: "Global Admissions" }],
    });
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
