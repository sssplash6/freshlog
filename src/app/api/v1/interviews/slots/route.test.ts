import { beforeEach, describe, expect, it, vi } from "vitest";

import { toDateInputValue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { programWallClock } from "@/lib/when";
import { mentor, program, student } from "@/test/db";

/**
 * Offering and removing a practice time, through the actions themselves, as
 * the signed-in `actor`, against the real database.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { POST } = await import("@/app/api/v1/interviews/slots/route");
const { DELETE } = await import("@/app/api/v1/interviews/slots/[id]/route");

const DAY = 24 * 60 * 60 * 1000;
const inWallDays = (n: number) => toDateInputValue(new Date(programWallClock(new Date()).getTime() + n * DAY));

const post = (body: unknown) =>
  POST(new Request("http://test", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const remove = (id: string) => DELETE(new Request("http://test", { method: "DELETE" }), { params: Promise.resolve({ id }) });

const as = (s: { userId: string } | { id: string }) => {
  actor.value = { id: "userId" in s ? s.userId : s.id };
};

async function scene() {
  const p = await program("Global Admissions");
  const host = await student({ programId: p.id, name: "Aziza Karimova" });
  const guest = await student({ programId: p.id, name: "Bekzod Tursunov" });
  return { p, host, guest };
}

const offer = { day: inWallDays(2), time: "15:00", minutes: 45 };

beforeEach(() => {
  actor.value = null;
});

describe("POST /api/v1/interviews/slots", () => {
  it("answers 401 with no user", async () => expect((await post(offer)).status).toBe(401));

  it("answers 403 inactive to a pending student", async () => {
    const p = await program();
    as(await student({ programId: p.id, status: "PENDING" }));
    expect((await (await post(offer)).json()).code).toBe("inactive");
  });

  it("refuses a mentor in the actions' words", async () => {
    as(await mentor());
    const res = await post(offer);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only approved students can practise interviews.");
  });

  it("offers the time as typed on the Tashkent clock", async () => {
    const { host } = await scene();
    as(host);
    const res = await post({ ...offer, meetingUrl: "https://meet.example/a" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const slot = await prisma.interviewSlot.findFirstOrThrow({ where: { studentId: host.id } });
    expect(slot.startsAt.toISOString()).toBe(`${offer.day}T15:00:00.000Z`);
    expect(slot).toMatchObject({ minutes: 45, meetingUrl: "https://meet.example/a" });
  });

  it("names the field that is wrong, in freshform's words", async () => {
    const { host } = await scene();
    as(host);
    const cases: [unknown, string, string][] = [
      [{ ...offer, day: "2026-02-31" }, "day", "Pick a date."],
      [{ ...offer, time: "25:00" }, "time", "Pick a start time."],
      [{ ...offer, day: inWallDays(-1) }, "day", "That time has already passed. Pick a later one."],
      [{ ...offer, day: inWallDays(70) }, "day", "Offer times within the next 60 days."],
      [{ ...offer, minutes: 50 }, "minutes", "Pick how long the interview runs."],
      [{ ...offer, meetingUrl: "http://meet.example" }, "meetingUrl", "Paste a meeting link that starts with https://."],
    ];
    for (const [body, field, error] of cases) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ field, error });
    }
    expect((await post("nope")).status).toBe(400);
    expect(await prisma.interviewSlot.count()).toBe(0);
  });

  it("refuses a time that clashes with one already offered", async () => {
    const { host } = await scene();
    as(host);
    await post(offer);
    const res = await post({ ...offer, time: "15:30" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("You already have something at that time.");
  });
});

describe("DELETE /api/v1/interviews/slots/:id", () => {
  async function offered() {
    const s = await scene();
    const slot = await prisma.interviewSlot.create({
      data: { studentId: s.host.id, startsAt: new Date(`${offer.day}T15:00:00.000Z`), minutes: 45 },
    });
    return { ...s, slot };
  }

  it("removes my open time", async () => {
    const { host, slot } = await offered();
    as(host);
    const res = await remove(slot.id);
    expect(res.status).toBe(200);
    expect(await prisma.interviewSlot.count()).toBe(0);
  });

  it("answers another student's time like one that does not exist", async () => {
    const { guest, slot } = await offered();
    as(guest);
    const theirs = await remove(slot.id);
    const missing = await remove("c-made-up");
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect(await prisma.interviewSlot.count()).toBe(1);
  });

  it("refuses a booked time in the action's words", async () => {
    const { host, guest, slot } = await offered();
    await prisma.peerInterview.create({ data: { slotId: slot.id, hostId: host.id, guestId: guest.id, template: "visa" } });
    as(host);
    const res = await remove(slot.id);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("A classmate booked this time. Cancel the interview instead.");
  });
});
