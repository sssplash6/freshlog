import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, allocation, grant, mentor, pairing, program, session, student } from "@/test/db";

/** Exchanges: lending a student, the lists on their page and the program's, and calling one off. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const lend = await import("@/app/api/v1/students/[id]/exchanges/route");
const back = await import("@/app/api/v1/exchanges/[id]/return/route");
const studentPage = await import("@/app/api/v1/students/[id]/admin/route");
const programPage = await import("@/app/api/v1/programs/[id]/route");

const json = (body: unknown) => new Request("http://test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  actor.value = null;
});

describe("exchanges", () => {
  it("lends a student from their own program, lists it on both pages, and calls it off while nothing was logged", async () => {
    const ga = await program("Global Admissions");
    const ms = await program("Master's");
    const nodira = await admin("Nodira Aliyeva");
    await grant({ userId: nodira.id, programId: ga.id });
    const aziz = await student({ programId: ga.id, name: "Aziz Tursunov" });
    actor.value = { id: nodira.id };

    const before = await (await studentPage.GET(new Request("http://test"), ctx(aziz.id))).json();
    expect(before.lend).toEqual({ from: [{ id: ga.id, label: "Global Admissions" }], to: [{ id: ms.id, name: "Master's" }] });
    expect(before.exchanges).toEqual([]);

    expect((await (await lend.POST(json({ from: ga.id, to: ms.id, minutes: 0, useBy: "2099-01-01" }), ctx(aziz.id))).json()).field).toBe("minutes");
    expect(await (await lend.POST(json({ from: ga.id, to: ms.id, minutes: 420, useBy: "2099-01-01", note: "Essay help" }), ctx(aziz.id))).json()).toMatchObject({ ok: true });

    const after = await (await studentPage.GET(new Request("http://test"), ctx(aziz.id))).json();
    expect(after.exchanges).toMatchObject([
      { student: null, from: { id: ga.id }, to: { id: ms.id }, open: true, cap: 420, useBy: "2099-01-01", unallocated: 420, note: "Essay help", sentBy: "Nodira Aliyeva", sessions: 0, canReturn: true },
    ]);

    // The host program's page names the student; calling it off is the student page's.
    const boss = await admin("Host Admin");
    await grant({ userId: boss.id, programId: ms.id });
    actor.value = { id: boss.id };
    const host = await (await programPage.GET(new Request("http://test"), ctx(ms.id))).json();
    expect(host.exchanges).toMatchObject([{ student: { id: aziz.id, name: "Aziz Tursunov" }, canReturn: false }]);

    // Somebody party to neither end is refused by the action.
    actor.value = { id: (await mentor("Stranger")).id };
    expect(await (await back.POST(json({}), ctx(after.exchanges[0].id))).json()).toMatchObject({ ok: false });
    actor.value = { id: nodira.id };
    expect(await (await back.POST(json({ note: "Not needed" }), ctx(after.exchanges[0].id))).json()).toMatchObject({ ok: true });
    expect((await (await studentPage.GET(new Request("http://test"), ctx(aziz.id))).json()).exchanges).toMatchObject([{ open: false, returnedBy: "Nodira Aliyeva", returnNote: "Not needed", canReturn: false }]);
  });

  it("refuses to call one off once a session was logged under it", async () => {
    const ga = await program("Global Admissions");
    const ms = await program("Master's");
    const nodira = await admin("Nodira Aliyeva");
    await grant({ userId: nodira.id, programId: ga.id });
    await grant({ userId: nodira.id, programId: ms.id });
    const aziz = await student({ programId: ga.id, name: "Aziz Tursunov" });
    actor.value = { id: nodira.id };
    await lend.POST(json({ from: ga.id, to: ms.id, minutes: 120, useBy: "2099-01-01" }), ctx(aziz.id));
    const ex = await prisma.programExchange.findFirstOrThrow({ where: { studentId: aziz.id } });
    const m = await mentor("Host Mentor");
    await pairing({ mentorId: m.id, programId: ms.id });
    const a = await allocation({ studentId: aziz.id, mentorId: m.id, programId: ms.id, minutes: 120 });
    await prisma.hourAllocation.update({ where: { id: a.id }, data: { exchangeId: ex.id } });
    const s = await session({ studentId: aziz.id, mentorId: m.id, programId: ms.id, minutes: 60 });
    await prisma.session.update({ where: { id: s.id }, data: { exchangeId: ex.id } });
    const read = await (await studentPage.GET(new Request("http://test"), ctx(aziz.id))).json();
    expect(read.exchanges[0]).toMatchObject({ sessions: 1, completed: 60, holders: ["Host Mentor"] });
    expect(await (await back.POST(json({}), ctx(ex.id))).json()).toMatchObject({ ok: false });
  });
});
