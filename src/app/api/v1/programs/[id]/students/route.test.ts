import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, allocation, cohort, enroll, grant, level, mentor, program, student } from "@/test/db";

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

const { GET, POST } = await import("@/app/api/v1/programs/[id]/students/route");
const roster = await import("@/app/api/v1/students/route");

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
    expect(await field({ level: lvl.id, cohort: c.id, rows: [row("Aziz", "Tursunov"), { ...row("Malika", "Saidova"), lastName: 5 }] })).toBe("rows.1.lastName");
    expect(await field({ rows: [row("Aziz", "Tursunov")] })).toBe("level");
    expect(await field({ level: lvl.id, rows: [row("Aziz", "Tursunov")] })).toBe("cohort");
    expect((await add(p.id, { level: lvl.id, cohort: c.id, rows: [row("Aziz", "Tursunov")] })).status).toBe(200);
  });

  it("adds the complete rows and names the incomplete ones, as the website does, rather than refusing them all", async () => {
    const { p, nodira } = await setUp();
    actor.value = { id: nodira.id };
    const res = await add(p.id, { rows: [row("Aziz", "Tursunov"), { ...row("Malika", "Saidova"), lastName: " " }] });
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/malika@test\.invalid \(needs a first and last name\)/);
    expect((await enrolled(p.id)).map((s) => s.user.name)).toEqual(["Aziz Tursunov"]);
  });

  it("says in words when a list is longer than one request takes", async () => {
    const { p, nodira } = await setUp();
    actor.value = { id: nodira.id };
    const many = Array.from({ length: 1001 }, (_, i) => ({ email: `s${i}@test.invalid`, firstName: "A", lastName: `B${i}` }));
    const res = await add(p.id, { rows: many });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Add up to 1,000 students at a time.", field: "rows" });
  });

  it("sends a class-hours program to the website", async () => {
    const { p, nodira } = await setUp();
    await prisma.program.update({ where: { id: p.id }, data: { classHours: true } });
    actor.value = { id: nodira.id };
    const res = await add(p.id, { rows: [row("Aziz", "Tursunov")] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Add class groups on the website.");
  });

  it("refuses an archived program, and adds nobody", async () => {
    const { p, nodira } = await setUp();
    await prisma.program.update({ where: { id: p.id }, data: { status: "ARCHIVED" } });
    actor.value = { id: nodira.id };
    const res = await add(p.id, { rows: [row("Aziz", "Tursunov")] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Global Admissions is archived, so it can't take students.");
    expect(await enrolled(p.id)).toEqual([]);
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

describe("GET /api/v1/programs/:id/students", () => {
  const read = (id: string, query = "") =>
    GET(new Request(`http://test/api/v1/programs/${id}/students${query}`), { params: Promise.resolve({ id }) });

  it("gives each student's figures in this program, as the program's page does, where /students sums both", async () => {
    const { p, nodira } = await setUp();
    const other = await program("Master's Program");
    await grant({ userId: nodira.id, programId: other.id });
    const m = await mentor("Akmal Karimov");
    const aziz = await student({ programId: p.id, name: "Aziz Tursunov" });
    await enroll({ studentId: aziz.id, programId: other.id });
    await allocation({ studentId: aziz.id, programId: p.id, mentorId: m.id, minutes: 300 });
    await allocation({ studentId: aziz.id, programId: other.id, mentorId: m.id, minutes: 600 });
    actor.value = { id: nodira.id };
    const here = await (await read(p.id)).json();
    expect(here.rows).toEqual([expect.objectContaining({ student: expect.objectContaining({ name: "Aziz Tursunov" }), remaining: 300 })]);
    expect(here.programs).toEqual([{ id: p.id, name: "Global Admissions", colorIndex: p.colorIndex }]);
    const everywhere = await (await roster.GET(new Request(`http://test/api/v1/students?program=${p.id}`))).json();
    expect(everywhere.rows[0].remaining).toBe(900);
  });

  it("narrows by name and by level, as the page's search and level tabs do", async () => {
    const { p, nodira } = await setUp();
    const lvl = await level({ programId: p.id, name: "Emerging" });
    await student({ programId: p.id, name: "Aziz Tursunov", levelId: lvl.id });
    await student({ programId: p.id, name: "Malika Saidova" });
    actor.value = { id: nodira.id };
    const names = async (query: string) => (await (await read(p.id, query)).json()).rows.map((r: { student: { name: string } }) => r.student.name);
    expect(await names("?q=malika")).toEqual(["Malika Saidova"]);
    expect(await names(`?level=${lvl.id}`)).toEqual(["Aziz Tursunov"]);
  });

  it("answers a program the reader doesn't read as one that doesn't exist", async () => {
    const { nodira } = await setUp();
    actor.value = { id: nodira.id };
    const theirs = await read((await program("Other")).id);
    expect(theirs.status).toBe(404);
  });
});
