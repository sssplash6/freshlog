import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, grant, mentor, program, student } from "@/test/db";

/** The Full Support application: who reads it, and each change through the website's action. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const snapshot = await import("@/app/api/v1/students/[id]/application/route");
const essays = await import("@/app/api/v1/students/[id]/application/essays/route");
const lists = await import("@/app/api/v1/students/[id]/universities/route");
const row = await import("@/app/api/v1/students/[id]/universities/[rowId]/route");
const words = await import("@/app/api/v1/universities/[id]/route");
const page = await import("@/app/api/v1/students/[id]/admin/route");

const json = (method: string, body: unknown) => new Request("http://test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const read = async (id: string) => (await (await page.GET(new Request("http://test"), ctx(id))).json()).application;

beforeEach(() => {
  actor.value = null;
});

describe("the application", () => {
  it("is read only where a program tracks admissions, and changes through each of the website's actions", async () => {
    const fs = await program("Full Support");
    const nodira = await admin("Nodira Aliyeva");
    await grant({ userId: nodira.id, programId: fs.id });
    const aziz = await student({ programId: fs.id, name: "Aziz Tursunov" });
    actor.value = { id: nodira.id };
    expect(await read(aziz.id)).toBeNull();
    await prisma.program.update({ where: { id: fs.id }, data: { tracksAdmissions: true } });
    expect(await read(aziz.id)).toMatchObject({ sat: null, universities: [], editable: true, canCorrectWords: true, known: [] });

    expect(await (await snapshot.PUT(json("PUT", { sat: "1480", ielts: "7.5", school: "Lyceum 1", gpa: "4.8/5" }), ctx(aziz.id))).json()).toMatchObject({ ok: true });
    expect(await (await snapshot.PUT(json("PUT", { sat: "2000", ielts: "", school: "", gpa: "" }), ctx(aziz.id))).json()).toMatchObject({ ok: false });
    expect(await (await essays.POST(json("POST", { target: "essay", stage: "WRITING" }), ctx(aziz.id))).json()).toMatchObject({ ok: true });

    expect(await (await lists.POST(json("POST", { name: "Yale University", words: 650 }), ctx(aziz.id))).json()).toMatchObject({ ok: true });
    const yale = await prisma.university.findFirstOrThrow({ where: { name: "Yale University" } });
    const other = await prisma.university.create({ data: { name: "MIT", nameKey: "mit", supplementalWords: 250 } });
    expect(await (await lists.POST(json("POST", { university: other.id, primary: true, round: "EA" }), ctx(aziz.id))).json()).toMatchObject({ ok: true });
    let app = await read(aziz.id);
    expect(app).toMatchObject({ sat: 1480, ielts: 7.5, school: "Lyceum 1", gpa: "4.8/5", essayStage: "WRITING" });
    expect(app.universities.map((u: { university: { name: string }; primary: boolean; round: string | null }) => [u.university.name, u.primary, u.round])).toEqual([
      ["MIT", true, "EA"],
      ["Yale University", false, null],
    ]);
    const yaleRow = app.universities[1].id;
    expect(await (await row.PATCH(json("PATCH", { round: "ED" }), { params: Promise.resolve({ id: aziz.id, rowId: yaleRow }) })).json()).toMatchObject({ ok: true });
    expect(await (await essays.POST(json("POST", { target: yaleRow, stage: "DONE" }), ctx(aziz.id))).json()).toMatchObject({ ok: true });
    app = await read(aziz.id);
    expect(app.universities[0]).toMatchObject({ id: yaleRow, primary: true, round: "ED", stage: "DONE" });

    expect(await (await words.PATCH(json("PATCH", { words: 700 }), ctx(yale.id))).json()).toMatchObject({ ok: true });
    expect((await prisma.university.findUniqueOrThrow({ where: { id: yale.id } })).supplementalWords).toBe(700);
    expect(await (await row.DELETE(new Request("http://test"), { params: Promise.resolve({ id: aziz.id, rowId: yaleRow }) })).json()).toMatchObject({ ok: true });
    expect((await read(aziz.id)).universities).toHaveLength(1);
    expect((await (await essays.POST(json("POST", { target: "essay", stage: "SOON" }), ctx(aziz.id))).json()).field).toBe("stage");

    // A mentor with nothing to do with them reads no application, and the actions refuse them.
    actor.value = { id: (await mentor("Stranger")).id };
    expect(await (await snapshot.PUT(json("PUT", { sat: "1500", ielts: "", school: "", gpa: "" }), ctx(aziz.id))).json()).toMatchObject({ ok: false });
    expect(await (await words.PATCH(json("PATCH", { words: 1 }), ctx(yale.id))).json()).toMatchObject({ ok: false });
  });
});
