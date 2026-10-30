import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, allocation, enroll, grant, mentor, platformAdmin, program, student } from "@/test/db";

/** The admin's roster: the students of the programs the reader reads, 25 a page. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/students/route");

const get = (query = "") => GET(new Request(`http://test/api/v1/students${query}`));
const names = async (query = "") => ((await (await get(query)).json()).rows as { student: { name: string } }[]).map((r) => r.student.name);

beforeEach(() => {
  actor.value = null;
});

async function school() {
  const ga = await program("Global Admissions");
  const masters = await program("Master's Program");
  const m = await mentor("Akmal Karimov");
  const aziz = await student({ programId: ga.id, name: "Aziz Tursunov" });
  await allocation({ studentId: aziz.id, mentorId: m.id, minutes: 300, deadlineInDays: 10 });
  const malika = await student({ programId: ga.id, name: "Malika Saidova", status: "PENDING" });
  await prisma.studentProfile.update({ where: { id: malika.id }, data: { telegramUsername: "malika" } });
  const sitora = await student({ programId: masters.id, name: "Sitora Nazarova" });
  await allocation({ studentId: sitora.id, minutes: 120, deadlineInDays: -3 });
  const nodira = await admin("Nodira Aliyeva");
  await grant({ userId: nodira.id, programId: ga.id });
  return { ga, masters, m, aziz, malika, sitora, nodira };
}

describe("GET /api/v1/students", () => {
  it("answers 401 with no user", async () => expect((await get()).status).toBe(401));

  it("answers 403 inactive to an account that isn't active", async () => {
    const s = await student({ status: "PENDING" });
    actor.value = { id: s.userId };
    expect((await (await get()).json()).code).toBe("inactive");
  });

  it("answers a reader with no program to read like a page that does not exist", async () => {
    await school();
    actor.value = { id: (await mentor("Just A Mentor")).id };
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "Not found." });
  });

  it("lists only the reader's programs' students, field by field", async () => {
    const { nodira, aziz, ga } = await school();
    actor.value = { id: nodira.id };
    const res = await get();
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page.rows.map((r: { student: { name: string } }) => r.student.name)).toEqual(["Aziz Tursunov", "Malika Saidova"]);
    expect(page).toMatchObject({ page: 1, pages: 1, shown: 2, programs: [expect.objectContaining({ id: ga.id })] });
    expect(page.rows[0]).toEqual({
      student: { id: aziz.id, userId: aziz.userId, name: "Aziz Tursunov" },
      approved: true,
      signedIn: false,
      programs: [expect.objectContaining({ id: ga.id, name: "Global Admissions" })],
      completed: 0,
      remaining: 300,
      used: 0,
      forfeited: 0,
      expiring: { minutes: 300, day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), daysLeft: expect.any(Number) },
      lastSession: null,
      openable: true,
      onExchange: false,
      telegram: null,
      folderUrl: null,
    });
    expect(JSON.stringify(page)).not.toContain("Sitora");
  });

  it("a pending student is not approved, Telegram or not", async () => {
    const { nodira } = await school();
    actor.value = { id: nodira.id };
    const page = await (await get("?status=pending")).json();
    expect(page.rows).toEqual([expect.objectContaining({ approved: false, signedIn: true, student: expect.objectContaining({ name: "Malika Saidova" }) })]);
  });

  it("filters by time as the website does, and counts what it shows", async () => {
    const { nodira, masters } = await school();
    await grant({ userId: nodira.id, programId: masters.id });
    actor.value = { id: nodira.id };
    expect(await names("?time=expiring")).toEqual(["Aziz Tursunov"]);
    expect(await names("?time=expired")).toEqual(["Sitora Nazarova"]);
    expect(await names("?time=none")).toEqual(["Malika Saidova"]);
    expect((await (await get("?time=none")).json()).shown).toBe(1);
    expect(await names(`?program=${masters.id}`)).toEqual(["Sitora Nazarova"]);
    expect(await names("?q=aziz")).toEqual(["Aziz Tursunov"]);
  });

  it("counts a student whose only grant was set to 0 as having no time, as the bell does", async () => {
    const { nodira, ga } = await school();
    const m = await mentor("Umid Rashidov");
    const otabek = await student({ programId: ga.id, name: "Otabek Yusupov" });
    // "Correct this allocation" to a total of 0: the row stays, with no time in it.
    await allocation({ studentId: otabek.id, mentorId: m.id, minutes: 0 });
    actor.value = { id: nodira.id };
    expect(await names("?time=none")).toEqual(["Malika Saidova", "Otabek Yusupov"]);
  });

  it("orders by what is left, least first, a tie keeping name order", async () => {
    const { nodira, masters } = await school();
    await grant({ userId: nodira.id, programId: masters.id });
    actor.value = { id: nodira.id };
    // Sitora's expired grant leaves her nothing, as Malika has nothing.
    expect(await names("?sort=remaining")).toEqual(["Malika Saidova", "Sitora Nazarova", "Aziz Tursunov"]);
    // The website's first click on Remaining, Completed and Last session is descending, and the app asks so.
    expect(await names("?sort=remaining&dir=desc")).toEqual(["Aziz Tursunov", "Malika Saidova", "Sitora Nazarova"]);
    expect(await names("?sort=student&dir=desc")).toEqual(["Sitora Nazarova", "Malika Saidova", "Aziz Tursunov"]);
    expect((await names("?sort=completed&dir=desc")).length).toBe(3);
  });

  it("refuses a word it doesn't know on its field", async () => {
    const { nodira } = await school();
    actor.value = { id: nodira.id };
    for (const [query, field] of [["?status=everyone", "status"], ["?time=soon", "time"], ["?sort=age", "sort"], ["?page=0", "page"]]) {
      const res = await get(query);
      expect(res.status).toBe(400);
      expect((await res.json()).field).toBe(field);
    }
  });

  it("pages 25 at a time", async () => {
    const p = await program("Big Program");
    const boss = await admin("Boss");
    await grant({ userId: boss.id, programId: p.id });
    for (let i = 0; i < 27; i++) await student({ programId: p.id, name: `Student ${String(i).padStart(2, "0")}` });
    actor.value = { id: boss.id };
    const first = await (await get()).json();
    expect(first).toMatchObject({ page: 1, pages: 2, shown: 27 });
    expect(first.rows).toHaveLength(25);
    const second = await (await get("?page=2")).json();
    expect(second.rows.map((r: { student: { name: string } }) => r.student.name)).toEqual(["Student 25", "Student 26"]);
  });

  it("shows a platform admin a student in no program, and says it can't be opened", async () => {
    await school();
    const loose = await student({ name: "Zafar Nowhere" });
    await prisma.studentEnrollment.deleteMany({ where: { studentId: loose.id } });
    actor.value = { id: (await platformAdmin("Head")).id };
    const page = await (await get("?q=Zafar")).json();
    expect(page.rows).toEqual([expect.objectContaining({ openable: false, programs: [] })]);
  });

  it("a scoped admin's row names only their programs", async () => {
    const { nodira, aziz, masters } = await school();
    await enroll({ studentId: aziz.id, programId: masters.id });
    actor.value = { id: nodira.id };
    const page = await (await get("?q=Aziz")).json();
    expect(page.rows[0].programs.map((p: { name: string }) => p.name)).toEqual(["Global Admissions"]);
  });
});
