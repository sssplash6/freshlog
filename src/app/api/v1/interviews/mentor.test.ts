import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { programWallClock } from "@/lib/when";
import { allocation, mentor, pairing, program, student } from "@/test/db";

/** Practice in a mentor's capacity, as the website's /mentor/interviews pages and a student's Your mentors. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const home = await import("@/app/api/v1/interviews/route");
const slots = await import("@/app/api/v1/interviews/slots/route");
const person = await import("@/app/api/v1/classmates/[id]/route");
const one = await import("@/app/api/v1/interviews/[id]/route");

const read = (as?: string) => home.GET(new Request(`http://test/api/v1/interviews${as ? `?as=${as}` : ""}`));
const post = (route: { POST: (r: Request) => Promise<Response> }, body: unknown) =>
  route.POST(new Request("http://test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const tomorrow = () => {
  const d = programWallClock(new Date(Date.now() + 24 * 60 * 60 * 1000));
  return d.toISOString().slice(0, 10);
};

async function scene() {
  const p = await program("Global Admissions");
  const dilnoza = await mentor("Dilnoza Yusupova");
  await pairing({ mentorId: dilnoza.id, programId: p.id });
  const aziz = await student({ programId: p.id, name: "Aziz Tursunov" });
  await allocation({ studentId: aziz.id, mentorId: dilnoza.id, minutes: 300 });
  return { p, dilnoza, aziz };
}

beforeEach(() => {
  actor.value = null;
});

describe("practice as a mentor", () => {
  it("gives a mentor their Interviews: their students, their times as a mentor, and a student their mentors offering", async () => {
    const { dilnoza, aziz } = await scene();
    actor.value = { id: dilnoza.id };
    // Asked as a student, a mentor is turned away in the actions' words.
    expect((await read()).status).toBe(403);
    const mine = await (await read("mentor")).json();
    expect(mine).toMatchObject({ as: "mentor", mentors: [], todo: [] });
    expect(mine.classmates).toMatchObject([{ id: aziz.userId, person: { name: "Aziz Tursunov" }, open: 0 }]);

    expect(await (await post(slots, { day: tomorrow(), time: "16:00", minutes: 60, as: "mentor" })).json()).toMatchObject({ ok: true });
    const offered = await prisma.interviewSlot.findFirstOrThrow({ where: { userId: dilnoza.id } });
    expect(offered.asMentor).toBe(true);
    expect((await (await read("mentor")).json()).times).toHaveLength(1);

    // The student sees her among Your mentors, and her page offers the time.
    actor.value = { id: aziz.userId };
    const theirs = await (await read()).json();
    expect(theirs.mentors).toMatchObject([{ id: dilnoza.id, person: { name: "Dilnoza Yusupova" }, open: 1, programs: [] }]);
    const page = await (await person.GET(new Request("http://test"), { params: Promise.resolve({ id: dilnoza.id }) })).json();
    expect(page).toMatchObject({ id: dilnoza.id, mentor: true, shared: [], slots: [{ id: offered.id }] });

    // Booked, the mentor interviews: no answers of theirs, the questions until feedback.
    const booked = await (await post(home, { slot: offered.id, template: "scholarship" })).json();
    expect(booked).toMatchObject({ ok: true, id: expect.any(String) });
    actor.value = { id: dilnoza.id };
    const interview = await (await one.GET(new Request("http://test"), { params: Promise.resolve({ id: booked.id }) })).json();
    expect(interview).toMatchObject({ part: "interviewer", can: { answer: false, feedback: true }, show: { questions: true, mine: true, theirs: false } });
    actor.value = { id: aziz.userId };
    expect(await (await one.GET(new Request("http://test"), { params: Promise.resolve({ id: booked.id }) })).json()).toMatchObject({
      part: "interviewee",
      can: { answer: true, feedback: false },
    });
  });

  it("lets a mentor book a student's own time as a mentor", async () => {
    const { dilnoza, aziz } = await scene();
    actor.value = { id: aziz.userId };
    expect(await (await post(slots, { day: tomorrow(), time: "15:00", minutes: 45 })).json()).toMatchObject({ ok: true });
    const slot = await prisma.interviewSlot.findFirstOrThrow({ where: { userId: aziz.userId } });
    actor.value = { id: dilnoza.id };
    const page = await (await person.GET(new Request("http://test/x?as=mentor"), { params: Promise.resolve({ id: aziz.userId }) })).json();
    expect(page).toMatchObject({ id: aziz.userId, mentor: false, shared: ["Global Admissions"], slots: [{ id: slot.id }] });
    const booked = await (await post(home, { slot: slot.id, template: "behavioral", as: "mentor" })).json();
    expect(booked).toMatchObject({ ok: true, id: expect.any(String) });
    expect((await prisma.peerInterview.findUniqueOrThrow({ where: { id: booked.id } })).mentorId).toBe(dilnoza.id);
  });
});
