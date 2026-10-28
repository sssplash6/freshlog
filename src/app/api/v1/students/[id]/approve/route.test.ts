import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, grant, mentor, program, session, student } from "@/test/db";

/** Approve and reject a student who signed up: the website's actions, behind the admin's gate. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// The welcome email is queued with `after()`, which needs a request.
vi.mock("@/lib/email/welcome", async (original) => ({
  ...(await original<typeof import("@/lib/email/welcome")>()),
  sendWelcomeEmails: () => {},
}));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const approve = (await import("@/app/api/v1/students/[id]/approve/route")).POST;
const reject = (await import("@/app/api/v1/students/[id]/reject/route")).POST;

const call = (route: typeof approve, id: string) =>
  route(new Request("http://test", { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  actor.value = null;
});

async function setUp() {
  const p = await program("Global Admissions");
  const malika = await student({ programId: p.id, name: "Malika Saidova", status: "PENDING" });
  const nodira = await admin("Nodira Aliyeva");
  await grant({ userId: nodira.id, programId: p.id });
  return { p, malika, nodira };
}

const statusOf = async (userId: string) => (await prisma.user.findUnique({ where: { id: userId } }))?.status ?? null;

describe.each([
  ["approve", approve],
  ["reject", reject],
])("POST /api/v1/students/:id/%s", (_, route) => {
  it("answers 401 with no user", async () => expect((await call(route, "x")).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    const { malika } = await setUp();
    actor.value = { id: malika.userId };
    expect((await (await call(route, malika.id)).json()).code).toBe("inactive");
  });

  it("a student outside the reader's programs answers like a missing one, and nothing changes", async () => {
    const { malika } = await setUp();
    const other = await admin("Elsewhere");
    await grant({ userId: other.id, programId: (await program("Other")).id });
    actor.value = { id: other.id };
    const theirs = await call(route, malika.id);
    const missing = await call(route, "c-made-up");
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect(await statusOf(malika.userId)).toBe("PENDING");
  });

  it("a Leader reads the student and may not change them: 403", async () => {
    const { p, malika } = await setUp();
    const leader = await admin("Lola Leader");
    await grant({ userId: leader.id, programId: p.id, role: "LEADER" });
    actor.value = { id: leader.id };
    const res = await call(route, malika.id);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("You don't administer any program this student is in.");
    expect(await statusOf(malika.userId)).toBe("PENDING");
  });
});

describe("approve", () => {
  it("lets them in, and says so again, not as a refusal, the second time", async () => {
    const { malika, nodira } = await setUp();
    actor.value = { id: nodira.id };
    const first = await call(approve, malika.id);
    expect(first.status).toBe(200);
    expect((await first.json()).message).toMatch(/approved/);
    expect(await statusOf(malika.userId)).toBe("ACTIVE");
    const again = await call(approve, malika.id);
    expect(again.status).toBe(200);
    expect((await again.json()).message).toBe("This student is already approved.");
  });
});

describe("reject", () => {
  it("removes the sign-up and the account", async () => {
    const { malika, nodira } = await setUp();
    actor.value = { id: nodira.id };
    const res = await call(reject, malika.id);
    expect(res.status).toBe(200);
    expect(await statusOf(malika.userId)).toBe(null);
  });

  it("is refused once a session stands, in the action's words", async () => {
    const { malika, nodira } = await setUp();
    await session({ studentId: malika.id, mentorId: (await mentor()).id, minutes: 60 });
    actor.value = { id: nodira.id };
    const res = await call(reject, malika.id);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("This student already has logged sessions.");
    expect(await statusOf(malika.userId)).toBe("PENDING");
  });
});
