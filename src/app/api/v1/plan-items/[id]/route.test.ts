import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { assignment, mentor, pairing, program, student } from "@/test/db";

/**
 * One plan item. A student reads their own and is never told its note, which is
 * the staff's; anybody else's answers exactly like an id that was never made.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/plan-items/[id]/route");

const get = (id: string) => GET(new Request("http://test"), { params: Promise.resolve({ id }) });

async function setUp(studentStatus?: string) {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id, status: studentStatus });
  const m = await mentor("Akmal Karimov");
  await pairing({ mentorId: m.id, programId: p.id });
  const row = await assignment({ studentId: st.id, programId: p.id, mentorId: m.id, purpose: "Personal statement" });
  const a = await prisma.assignment.update({ where: { id: row.id }, data: { note: "Weak on structure." } });
  return { st, m, a };
}

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/plan-items/:id", () => {
  it("answers 401 with no user", async () => expect((await get("x")).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    const { st, a } = await setUp("PENDING");
    actor.value = { id: st.userId };
    const res = await get(a.id);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("another student's plan item answers like a missing one", async () => {
    const { a } = await setUp();
    const other = await student({ name: "Other Student" });
    actor.value = { id: other.userId };
    const theirs = await get(a.id);
    const missing = await get("c-made-up");
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
  });

  it("a student's plan item answer carries no note", async () => {
    const { st, a } = await setUp();
    actor.value = { id: st.userId };
    const res = await get(a.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item).toMatchObject({ id: a.id, purpose: "Personal statement", note: null });
    expect(JSON.stringify(body)).not.toContain("Weak on structure.");
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("answers the mentor with the note", async () => {
    const { m, a } = await setUp();
    actor.value = { id: m.id };
    const body = await (await get(a.id)).json();
    expect(body.item).toMatchObject({ note: "Weak on structure.", can: { edit: true, progress: true } });
  });
});
