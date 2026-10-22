import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { mentor, program, session, student } from "@/test/db";

/**
 * One session, to the people it belongs to. Anybody else's answers exactly like
 * an id that was never made, so the answer cannot be used to find out which
 * sessions exist.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/sessions/[id]/route");

const get = (id: string) => GET(new Request("http://test"), { params: Promise.resolve({ id }) });

/** A mentor's session with their student, logged for October 22. */
async function logged(studentStatus?: string) {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id, status: studentStatus });
  const m = await mentor("Akmal Karimov");
  const created = await session({ studentId: st.id, mentorId: m.id, minutes: 60 });
  const s = await prisma.session.update({
    where: { id: created.id },
    data: { date: new Date("2026-10-22T00:00:00.000Z") },
  });
  return { st, m, s };
}

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/sessions/:id", () => {
  it("answers 401 with no user", async () => expect((await get("x")).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    // Even about a session of their own: the gate turns them away before
    // anything is read.
    const { st, s } = await logged("PENDING");
    actor.value = { id: st.userId };
    const res = await get(s.id);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("answers another mentor's session exactly like a missing one", async () => {
    const { s } = await logged();
    const other = await mentor("Umid Rashidov");
    actor.value = { id: other.id };
    const theirs = await get(s.id);
    const missing = await get("c-made-up");
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
  });

  it("answers the mentor with the session", async () => {
    const { m, s } = await logged();
    actor.value = { id: m.id };
    const res = await get(s.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: s.id, day: "2026-10-22", can: { edit: true } });
  });
});
