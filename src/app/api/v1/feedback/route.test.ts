import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, allocation, grant, mentor, pairing, program, session, student } from "@/test/db";

/**
 * A student's ratings. What is pinned: only a student rates, only a mentor
 * they work with, each send is a report of its own, and the mentor is never
 * told who wrote it.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET, POST } = await import("@/app/api/v1/feedback/route");

const post = (body: unknown) =>
  POST(new Request("http://test/api/v1/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  actor.value = null;
});

describe("GET and POST /api/v1/feedback", () => {
  it("answers 401 with no user, 403 inactive to a pending student, and 403 to a mentor", async () => {
    expect((await GET()).status).toBe(401);
    const pending = await student({ status: "PENDING" });
    actor.value = { id: pending.userId };
    expect((await GET()).status).toBe(403);
    actor.value = { id: (await mentor()).id };
    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only students can leave mentor feedback.");
  });

  it("lists the mentors a student holds time with or met through a bank, and what they sent", async () => {
    const p = await program();
    const s = await student({ programId: p.id });
    const held = await mentor("Akmal Karimov");
    const banked = await mentor("Bobur Bank");
    const stranger = await mentor("Zara Stranger");
    await allocation({ studentId: s.id, mentorId: held.id, minutes: 300 });
    await session({ studentId: s.id, mentorId: banked.id, minutes: 60, fromBank: true });
    await prisma.mentorFeedback.create({ data: { studentId: s.id, mentorId: held.id, rating: 4, comment: "Clear." } });
    actor.value = { id: s.userId };
    const body = await (await GET()).json();
    expect(body.mentors.map((m: { name: string }) => m.name)).toEqual(["Akmal Karimov", "Bobur Bank"]);
    expect(JSON.stringify(body)).not.toContain(stranger.id);
    expect(body.given).toMatchObject([{ mentor: { id: held.id }, rating: 4, comment: "Clear." }]);
    expect(body.given[0].sentOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps each rating as its own report, tells the program's admins the score only, and names nobody to the mentor", async () => {
    const p = await program();
    const s = await student({ programId: p.id });
    const m = await mentor();
    const staff = await admin("Program Admin");
    await grant({ userId: staff.id, programId: p.id });
    await allocation({ studentId: s.id, mentorId: m.id, minutes: 300 });
    // The action takes a mentor paired with the student's program, or one who logged a session with them.
    await pairing({ mentorId: m.id, programId: p.id });
    actor.value = { id: s.userId };
    expect(await (await post({ mentor: m.id, rating: 2, comment: "Late twice." })).json()).toMatchObject({ ok: true });
    expect(await (await post({ mentor: m.id, rating: 3 })).json()).toMatchObject({ ok: true });
    expect(await prisma.mentorFeedback.count({ where: { mentorId: m.id } })).toBe(2);
    const notices = await prisma.notification.findMany({ where: { userId: staff.id } });
    expect(notices.map((n) => n.message)).toEqual(expect.arrayContaining(["A student rated their mentor 2 out of 5."]));
    expect(JSON.stringify(notices)).not.toContain("Late twice");
    expect(await prisma.notification.count({ where: { userId: m.id } })).toBe(0);
  });

  it("refuses a mentor the student doesn't work with, and a rating out of range, on their fields", async () => {
    const s = await student();
    const stranger = await mentor();
    actor.value = { id: s.userId };
    const res = await post({ mentor: stranger.id, rating: 5 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Pick one of your mentors.");
    expect(await (await post({ mentor: stranger.id, rating: 6 })).json()).toMatchObject({ field: "rating" });
    expect(await (await post({ rating: 4 })).json()).toMatchObject({ field: "mentor" });
  });
});
