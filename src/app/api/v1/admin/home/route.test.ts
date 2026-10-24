import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, allocation, grant, mentor, pairing, platformAdmin, program, student } from "@/test/db";

/**
 * The admin's home belongs to somebody who reads a program. Anybody else is
 * answered as if there were no such page.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/admin/home/route");

beforeEach(() => {
  actor.value = null;
});

async function school() {
  const p = await program("Global Admissions");
  const other = await program("Master's Program");
  const m = await mentor("Akmal Karimov");
  await pairing({ mentorId: m.id, programId: p.id });
  const aziz = await student({ programId: p.id, name: "Aziz Tursunov" });
  // Expires in 10 days: inside the staff's 14.
  await allocation({ studentId: aziz.id, mentorId: m.id, minutes: 300, deadlineInDays: 10 });
  await student({ programId: p.id, name: "Malika Saidova", status: "PENDING" });
  // Another program's pending student, whom a Global admin must not count.
  await student({ programId: other.id, name: "Sitora Nazarova", status: "PENDING" });
  return { p, other, m, aziz };
}

describe("GET /api/v1/admin/home", () => {
  it("answers 401 with no user", async () => expect((await GET()).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    const s = await student({ status: "PENDING" });
    actor.value = { id: s.userId };
    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("answers a reader with no grant like a page that does not exist", async () => {
    await school();
    const nobody = await admin("No Grants");
    actor.value = { id: nobody.id };
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "Not found." });
    const m = await mentor("Just A Mentor");
    actor.value = { id: m.id };
    expect((await GET()).status).toBe(404);
  });

  it("answers an admin with their programs, figures and To do, counting only their own", async () => {
    const { p } = await school();
    const nodira = await admin("Nodira Aliyeva");
    await grant({ userId: nodira.id, programId: p.id });
    await prisma.notification.create({ data: { userId: nodira.id, type: "STUDENT_SIGNUP", message: "New" } });
    actor.value = { id: nodira.id };
    const res = await GET();
    expect(res.status).toBe(200);
    const home = await res.json();
    expect(home.summary).toEqual({ remaining: 300, students: 2, programs: 1, pending: 1, expiring: 1 });
    expect(home.programs).toEqual([
      expect.objectContaining({
        program: expect.objectContaining({ id: p.id, name: "Global Admissions" }),
        archived: false,
        students: 2,
        mentors: 1,
        allotted: 300,
        remaining: 300,
        can: { write: true },
      }),
    ]);
    expect(home.todo.map((row: { type: string }) => row.type)).toContain("STUDENT_PENDING_APPROVAL");
    expect(JSON.stringify(home)).not.toContain("Sitora");
    expect(home.unread).toBe(1);
    expect(home.platformAdmin).toBe(false);
    expect(home.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("never prefills a session to log, even on time that is running out", async () => {
    const { p } = await school();
    const nodira = await admin("Nodira Aliyeva");
    await grant({ userId: nodira.id, programId: p.id });
    actor.value = { id: nodira.id };
    const home = await (await GET()).json();
    expect(home.todo.some((row: { type: string }) => row.type === "ALLOCATION_EXPIRING")).toBe(true);
    expect(home.todo.every((row: { log: unknown }) => row.log === null)).toBe(true);
  });

  it("gives a Leader the same home with nothing to change", async () => {
    const { p, other } = await school();
    const leader = await admin("Lola Leader");
    await grant({ userId: leader.id, programId: p.id, role: "LEADER" });
    await grant({ userId: leader.id, programId: other.id, role: "SALES" });
    actor.value = { id: leader.id };
    const home = await (await GET()).json();
    expect(home.programs).toHaveLength(2);
    expect(home.programs.every((row: { can: { write: boolean } }) => row.can.write === false)).toBe(true);
  });

  it("lists running programs first, then archived, each by name", async () => {
    const boss = await platformAdmin("Head");
    await prisma.program.create({ data: { name: "Zeta" } });
    await prisma.program.create({ data: { name: "alpha", status: "ARCHIVED" } });
    await prisma.program.create({ data: { name: "Beta" } });
    actor.value = { id: boss.id };
    const home = await (await GET()).json();
    expect(home.programs.map((row: { program: { name: string }; archived: boolean }) => [row.program.name, row.archived])).toEqual([
      ["Beta", false],
      ["Zeta", false],
      ["alpha", true],
    ]);
  });

  it("gives a platform admin with no programs an empty school", async () => {
    const boss = await platformAdmin("Head");
    actor.value = { id: boss.id };
    const res = await GET();
    expect(res.status).toBe(200);
    const home = await res.json();
    expect(home.summary).toEqual({ remaining: 0, students: 0, programs: 0, pending: 0, expiring: 0 });
    expect(home.programs).toEqual([]);
    expect(home.platformAdmin).toBe(true);
  });
});
