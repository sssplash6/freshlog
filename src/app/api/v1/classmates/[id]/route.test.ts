import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { programWallClock } from "@/lib/when";
import { enroll, program, student } from "@/test/db";

/** A classmate's page, and booking one of their times (`POST /api/v1/interviews`). */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/classmates/[id]/route");
const { POST } = await import("@/app/api/v1/interviews/route");

const HOUR = 60 * 60 * 1000;
function wallHoursFromNow(hours: number): Date {
  const d = programWallClock(new Date());
  d.setUTCMinutes(0, 0, 0);
  return new Date(d.getTime() + hours * HOUR);
}

const read = (id: string) => GET(new Request("http://test"), { params: Promise.resolve({ id }) });
const book = (body: unknown) => POST(new Request("http://test", { method: "POST", body: JSON.stringify(body) }));
const as = (s: { userId: string }) => {
  actor.value = { id: s.userId };
};

async function scene() {
  const p = await program("Global Admissions");
  const host = await student({ programId: p.id, name: "Aziza Karimova" });
  const guest = await student({ programId: p.id, name: "Bekzod Tursunov" });
  const slot = await prisma.interviewSlot.create({
    data: { userId: host.userId, startsAt: wallHoursFromNow(48), minutes: 45, meetingUrl: "https://meet.example/a" },
  });
  return { p, host, guest, slot };
}

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/classmates/:id", () => {
  it("answers 401 with no user", async () => expect((await read("x")).status).toBe(401));

  it("reads a classmate: their own programs, the open times, no link and no email", async () => {
    const { p, host, guest, slot } = await scene();
    const other = await program("Master's Program");
    await enroll({ studentId: host.id, programId: other.id });
    as(guest);
    const res = await read(host.userId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: host.userId, person: { id: host.userId, name: "Aziza Karimova" }, mentor: false, shared: [p.name, other.name] });
    expect(body.slots).toEqual([{ id: slot.id, when: expect.objectContaining({ minutes: 45 }) }]);
    expect(body.templates.length).toBeGreaterThan(0);
    expect(body.templates[0]).not.toHaveProperty("questions");
    expect(JSON.stringify(body)).not.toContain("meet.example");
    expect(JSON.stringify(body)).not.toContain("@");
  });

  it("reads a student in another program", async () => {
    const { host } = await scene();
    const other = await program("Freshman Scholars");
    const stranger = await student({ programId: other.id, name: "Dilnoza" });
    as(stranger);
    expect(await (await read(host.userId)).json()).toMatchObject({ id: host.userId, shared: ["Global Admissions"] });
  });

  it("answers myself, a student awaiting approval and nobody alike", async () => {
    const { p, guest } = await scene();
    const pending = await student({ programId: p.id, name: "Pending", status: "PENDING" });
    as(guest);
    const missing = await (await read("c-made-up")).json();
    for (const id of [pending.userId, guest.userId]) {
      const res = await read(id);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(missing);
    }
  });
});

describe("POST /api/v1/interviews", () => {
  it("books the time, tells the host, and answers the new interview's id", async () => {
    const { host, guest, slot } = await scene();
    as(guest);
    const res = await book({ slot: slot.id, template: "scholarship" });
    expect(res.status).toBe(200);
    const body = await res.json();
    const made = await prisma.peerInterview.findUniqueOrThrow({ where: { slotId: slot.id } });
    expect(body).toEqual({ ok: true, id: made.id });
    expect(made).toMatchObject({ hostId: host.userId, guestId: guest.userId, template: "scholarship" });
    expect(await prisma.notification.count({ where: { userId: host.userId, type: "PEER_INTERVIEW_BOOKED" } })).toBe(1);
  });

  it("names a bad field", async () => {
    const { guest, slot } = await scene();
    as(guest);
    expect(await (await book({ template: "scholarship" })).json()).toMatchObject({ field: "slot" });
    expect(await (await book({ slot: slot.id, template: "made-up" })).json()).toMatchObject({ field: "template" });
  });

  it("books a time once, and refuses my own in the action's words", async () => {
    const { p, host, guest, slot } = await scene();
    const third = await student({ programId: p.id, name: "Charos" });
    as(guest);
    expect((await book({ slot: slot.id, template: "visa" })).status).toBe(200);
    as(third);
    const taken = await book({ slot: slot.id, template: "visa" });
    expect(taken.status).toBe(400);
    expect((await taken.json()).error).toBe("That time isn't available any more. Pick another.");

    const mine = await prisma.interviewSlot.create({ data: { userId: host.userId, startsAt: wallHoursFromNow(72), minutes: 30 } });
    as(host);
    expect((await (await book({ slot: mine.id, template: "visa" })).json()).error).toBe("That's one of your own times.");
  });

  it("refuses a time that has started", async () => {
    const { host, guest } = await scene();
    const started = await prisma.interviewSlot.create({ data: { userId: host.userId, startsAt: wallHoursFromNow(-1), minutes: 60 } });
    as(guest);
    expect((await book({ slot: started.id, template: "visa" })).status).toBe(400);
    expect(await prisma.peerInterview.count()).toBe(0);
  });
});
