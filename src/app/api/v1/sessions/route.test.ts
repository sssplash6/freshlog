import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionsPage } from "@/lib/api/v1/types";
import { prisma } from "@/lib/prisma";
import { admin, grant, mentor, program, session, student } from "@/test/db";

/**
 * The reader's ledger over HTTP: who is turned away, and what the URL asks for.
 * What a list holds and how it pages is `sessions-page.test.ts`'s.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/sessions/route");

const get = (query = "") => GET(new Request(`http://test/api/v1/sessions${query}`));
const pageFrom = async (res: Response): Promise<SessionsPage> => res.json();
const idsOf = (page: SessionsPage) => page.items.map((item) => item.id);

/** A mentor with a student, and three 60-minute sessions of theirs on October 20, 19 and 18. */
async function ledger() {
  const p = await program("Global Admissions");
  const aziz = await student({ programId: p.id, name: "Aziz Tursunov" });
  const akmal = await mentor("Akmal Karimov");
  const rows = [];
  for (const date of ["2026-10-20", "2026-10-19", "2026-10-18"]) {
    rows.push(
      await prisma.session.create({
        data: {
          studentId: aziz.id,
          mentorId: akmal.id,
          programId: p.id,
          minutes: 60,
          date: new Date(`${date}T00:00:00.000Z`),
          note: `Covered ${date}.`,
        },
      })
    );
  }
  return { p, aziz, akmal, rows };
}

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/sessions", () => {
  it("answers 401 with no user", async () => {
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "Sign in again.", code: "unauthenticated" });
  });

  it("answers 403 inactive to an account that isn't active, even about sessions of its own", async () => {
    const { aziz, akmal } = await ledger();
    await prisma.user.update({ where: { id: aziz.userId }, data: { status: "PENDING" } });
    await prisma.user.update({ where: { id: akmal.id }, data: { status: "UNASSIGNED" } });
    for (const id of [aziz.userId, akmal.id]) {
      actor.value = { id };
      const res = await get();
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ ok: false, error: "Your account isn't active yet.", code: "inactive" });
    }
  });

  it("answers 404 to a signed-in person who is neither a student nor a mentor", async () => {
    const { p } = await ledger();
    const nobody = await admin("Dilnoza Yusupova");
    // A program's sessions, as its admin reads them, are asked for with as=admin (admin.test.ts).
    const boss = await admin("Nodira Aliyeva");
    await grant({ userId: boss.id, programId: p.id });
    for (const id of [nobody.id, boss.id]) {
      actor.value = { id };
      const res = await get();
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ ok: false, error: "Not found." });
    }
  });

  it("answers a mentor with their sessions, a cursor, and the figures for the whole list", async () => {
    const { p, akmal, rows } = await ledger();
    actor.value = { id: akmal.id };
    const res = await get("?limit=2");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const page = await pageFrom(res);
    expect(idsOf(page)).toEqual([rows[0].id, rows[1].id]);
    expect(page.items[0]).toMatchObject({ day: "2026-10-20", note: "Covered 2026-10-20.", can: { edit: true } });
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(page.totals).toEqual({ count: 3, charged: 180, missed: 0, extra: 0, voided: 0 });
    expect(page.counts).toEqual({ disputed: 0, voided: 0 });
    expect(page.programs).toEqual([{ id: p.id, name: "Global Admissions", colorIndex: p.colorIndex }]);
  });

  it("reads the cursor, the limit and the filters from the URL", async () => {
    const { p, akmal, rows } = await ledger();
    actor.value = { id: akmal.id };

    const first = await pageFrom(await get("?limit=2"));
    const second = await pageFrom(await get(`?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`));
    expect(idsOf(second)).toEqual([rows[2].id]);
    expect(second.nextCursor).toBeNull();

    await prisma.session.update({ where: { id: rows[1].id }, data: { status: "VOIDED" } });
    expect(idsOf(await pageFrom(await get("?status=voided")))).toEqual([rows[1].id]);
    expect(idsOf(await pageFrom(await get("?status=active")))).toEqual([rows[0].id, rows[2].id]);
    expect(idsOf(await pageFrom(await get("?q=2026-10-18")))).toEqual([rows[2].id]);
    await prisma.session.update({ where: { id: rows[0].id }, data: { studentAnswer: "DISPUTED" } });
    expect(idsOf(await pageFrom(await get("?answer=disputed")))).toEqual([rows[0].id]);
    expect(idsOf(await pageFrom(await get(`?program=${p.id}&limit=1`)))).toEqual([rows[0].id]);
    expect(idsOf(await pageFrom(await get("?program=c-made-up")))).toEqual([]);
  });

  it("takes only the filters the contract has", async () => {
    const { akmal, rows } = await ledger();
    actor.value = { id: akmal.id };
    // A mentor's own list ignores another mentor, and a word that isn't one of the contract's means nothing:
    // each of these would empty the list if it were read.
    const res = await get(
      `?mentor=${(await mentor("Umid Rashidov")).id}&attendance=present&kind=both&rating=1&status=rescheduled&period=forever`
    );
    expect(res.status).toBe(200);
    expect(idsOf(await pageFrom(res))).toEqual(rows.map((row) => row.id));
  });

  it("narrows a student's own list to one mentor, for that mentor's page", async () => {
    const { p, aziz, akmal, rows } = await ledger();
    const umid = await mentor("Umid Rashidov");
    const other = await session({ studentId: aziz.id, programId: p.id, mentorId: umid.id, minutes: 30 });
    actor.value = { id: aziz.userId };
    expect(idsOf(await pageFrom(await get(`?mentor=${akmal.id}`)))).toEqual(rows.map((row) => row.id));
    expect(idsOf(await pageFrom(await get(`?mentor=${umid.id}`)))).toEqual([other.id]);
    expect(idsOf(await pageFrom(await get("?mentor=nobody")))).toEqual([]);
  });

  it("answers 400 on cursor to a cursor it can't read", async () => {
    const { akmal } = await ledger();
    actor.value = { id: akmal.id };
    const res = await get("?cursor=%25%25%25");
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: false, error: "Load the list again.", field: "cursor" });
  });

  it("answers a student with their own sessions, without the mentor's note, whatever q says", async () => {
    const { aziz, rows } = await ledger();
    actor.value = { id: aziz.userId };
    // Nothing is called this, so a q that was read would empty the list; a student's isn't.
    const page = await pageFrom(await get("?q=Covered%20on%20Mars"));
    expect(idsOf(page)).toEqual(rows.map((row) => row.id));
    expect(page.items.map((item) => item.note)).toEqual([null, null, null]);
  });

  // `/me` lists a student who also mentors as ["student", "mentor"], and the app's
  // mentor side asks for its list with as=mentor.
  it("gives a student who also mentors their own sessions, and the ones they logged with as=mentor", async () => {
    const { p, aziz, rows } = await ledger();
    await prisma.user.update({ where: { id: aziz.userId }, data: { isMentor: true } });
    const malika = await student({ programId: p.id, name: "Malika Rahimova" });
    const logged = await prisma.session.create({
      data: {
        studentId: malika.id,
        mentorId: aziz.userId,
        programId: p.id,
        minutes: 45,
        date: new Date("2026-10-21T00:00:00.000Z"),
        note: "Mock interview.",
      },
    });
    actor.value = { id: aziz.userId };

    const own = await pageFrom(await get());
    expect(idsOf(own)).toEqual(rows.map((row) => row.id));
    expect(own.items.map((item) => item.note)).toEqual([null, null, null]);

    const res = await get("?as=mentor");
    expect(res.status).toBe(200);
    const theirs = await pageFrom(res);
    expect(idsOf(theirs)).toEqual([logged.id]);
    // Theirs as the mentor who logged it: their own note, and theirs to correct.
    expect(theirs.items[0]).toMatchObject({ note: "Mock interview.", can: { edit: true } });
    expect(theirs.totals).toEqual({ count: 1, charged: 45, missed: 0, extra: 0, voided: 0 });
  });

  it("answers 404 to a student who doesn't mentor and asks for as=mentor, as it answers anyone with no ledger", async () => {
    const { aziz } = await ledger();
    actor.value = { id: aziz.userId };
    expect((await get()).status).toBe(200);
    const res = await get("?as=mentor");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "Not found." });
  });

  it("answers a mentor with as=mentor what it answers them without it", async () => {
    const { akmal } = await ledger();
    actor.value = { id: akmal.id };
    const asked = await get("?as=mentor&limit=2");
    expect(asked.status).toBe(200);
    expect(await asked.json()).toEqual(await (await get("?limit=2")).json());
  });

  it("never lists another mentor's sessions, or another student's", async () => {
    const { p } = await ledger();
    const umid = await mentor("Umid Rashidov");
    const malika = await student({ programId: p.id, name: "Malika Rahimova" });
    for (const id of [umid.id, malika.userId]) {
      actor.value = { id };
      expect(await pageFrom(await get())).toMatchObject({
        items: [],
        nextCursor: null,
        totals: { count: 0, charged: 0 },
        programs: [],
      });
    }
  });
});
