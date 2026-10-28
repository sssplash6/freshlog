import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, cohort, grant, level, program, student } from "@/test/db";

/** Adding students to a program: the website's `createStudents`, one request for every row. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/email/welcome", async (original) => ({
  ...(await original<typeof import("@/lib/email/welcome")>()),
  sendWelcomeEmails: () => {},
}));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { POST } = await import("@/app/api/v1/programs/[id]/students/route");

const add = (id: string, body: unknown) =>
  POST(new Request("http://test", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const row = (first: string, last: string, folderUrl?: string) => ({
  email: `${first.toLowerCase()}@test.invalid`,
  firstName: first,
  lastName: last,
  ...(folderUrl ? { folderUrl } : {}),
});

beforeEach(() => {
  actor.value = null;
});

async function setUp() {
  const p = await program("Global Admissions");
  const nodira = await admin("Nodira Aliyeva");
  await grant({ userId: nodira.id, programId: p.id });
  return { p, nodira };
}

const enrolled = (programId: string) =>
  prisma.studentProfile.findMany({ where: { enrollments: { some: { programId } } }, include: { user: true }, orderBy: { user: { name: "asc" } } });

describe("POST /api/v1/programs/:id/students", () => {
  it("answers 401, a 404 for a program the reader does not read, and a 403 to a Leader", async () => {
    expect((await add("x", { rows: [] })).status).toBe(401);
    const { p, nodira } = await setUp();
    actor.value = { id: nodira.id };
    expect((await add((await program("Other")).id, { rows: [row("Aziz", "Tursunov")] })).status).toBe(404);
    const leader = await admin("Lola Leader");
    await grant({ userId: leader.id, programId: p.id, role: "LEADER" });
    actor.value = { id: leader.id };
    expect((await add(p.id, { rows: [row("Aziz", "Tursunov")] })).status).toBe(403);
    expect(await enrolled(p.id)).toEqual([]);
  });

  it("adds one, then three with a skip the message names, each folder on its own student", async () => {
    const { p, nodira } = await setUp();
    actor.value = { id: nodira.id };
    const one = await add(p.id, { rows: [row("Aziz", "Tursunov")] });
    expect(one.status).toBe(200);
    expect((await one.json()).message).toMatch(/1 student/);
    const three = await add(p.id, {
      rows: [row("Malika", "Saidova"), row("Aziz", "Tursunov"), row("Sitora", "Nazarova", "https://drive.test/sitora")],
    });
    expect(three.status).toBe(200);
    expect((await three.json()).message).toMatch(/already in this program/);
    const students = await enrolled(p.id);
    expect(students.map((s) => [s.user.name, s.folderUrl])).toEqual([
      ["Aziz Tursunov", null],
      ["Malika Saidova", null],
      ["Sitora Nazarova", "https://drive.test/sitora"],
    ]);
  });

  it("names a bad row's field, and the level and cohort the program needs", async () => {
    const { p, nodira } = await setUp();
    const lvl = await level({ programId: p.id, name: "Emerging" });
    const c = await cohort({ programId: p.id, levelId: lvl.id, name: "Autumn" });
    actor.value = { id: nodira.id };
    const field = async (body: unknown) => (await (await add(p.id, body)).json()).field;
    expect(await field({ rows: [] })).toBe("rows");
    expect(await field({ level: lvl.id, cohort: c.id, rows: [row("Aziz", "Tursunov"), { ...row("Malika", "Saidova"), lastName: " " }] })).toBe("rows.1.lastName");
    expect(await field({ rows: [row("Aziz", "Tursunov")] })).toBe("level");
    expect(await field({ level: lvl.id, rows: [row("Aziz", "Tursunov")] })).toBe("cohort");
    expect((await add(p.id, { level: lvl.id, cohort: c.id, rows: [row("Aziz", "Tursunov")] })).status).toBe(200);
  });

  it("sends a class-hours program to the website", async () => {
    const { p, nodira } = await setUp();
    await prisma.program.update({ where: { id: p.id }, data: { classHours: true } });
    actor.value = { id: nodira.id };
    const res = await add(p.id, { rows: [row("Aziz", "Tursunov")] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Add class groups on the website.");
  });

  it("an all-skipped list is the action's refusal", async () => {
    const { p, nodira } = await setUp();
    const existing = await student({ programId: p.id, name: "Aziz Tursunov" });
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: existing.userId } })).email;
    actor.value = { id: nodira.id };
    const res = await add(p.id, { rows: [{ email, firstName: "Aziz", lastName: "Tursunov" }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/No students added/);
  });
});
