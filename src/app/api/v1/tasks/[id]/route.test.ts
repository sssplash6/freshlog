import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { mentor, pairing, program, student, studentTask } from "@/test/db";

/**
 * One task, to the people it belongs to. Anybody else's answers exactly like an
 * id that was never made, so the answer cannot be used to find out which tasks
 * exist.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/tasks/[id]/route");

const get = (id: string) => GET(new Request("http://test"), { params: Promise.resolve({ id }) });

/** A student's task, set by their mentor, due 2026-11-03. */
async function setUp(studentStatus?: string) {
  const p = await program("Global Admissions");
  const st = await student({ programId: p.id, status: studentStatus });
  const m = await mentor("Akmal Karimov");
  await pairing({ mentorId: m.id, programId: p.id });
  const t = await studentTask({ studentId: st.id, mentorId: m.id, programId: p.id });
  await prisma.studentTask.update({ where: { id: t.id }, data: { dueOn: new Date("2026-11-03T00:00:00.000Z") } });
  return { p, st, m, t };
}

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/tasks/:id", () => {
  it("answers 401 with no user", async () => expect((await get("x")).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    const { st, t } = await setUp("PENDING");
    actor.value = { id: st.userId };
    const res = await get(t.id);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("another student's task answers like a missing one", async () => {
    const { t } = await setUp();
    const other = await student({ name: "Other Student" });
    actor.value = { id: other.userId };
    const theirs = await get(t.id);
    const missing = await get("c-made-up");
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
  });

  it("answers the student with the task and the program's today", async () => {
    const { st, t } = await setUp();
    actor.value = { id: st.userId };
    const res = await get(t.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      task: { id: t.id, due: "2026-11-03", percent: 0, can: { progress: true, edit: false, delete: false } },
    });
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
