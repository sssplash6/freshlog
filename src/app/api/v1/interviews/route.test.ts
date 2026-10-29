import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { programWallClock } from "@/lib/when";
import { enroll, mentor, program, student } from "@/test/db";

/**
 * The Practice tab. It reads the database as the signed-in `actor`; what it
 * pins is who counts as a classmate, and what one student sees of another.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/interviews/route");

const HOUR = 60 * 60 * 1000;

/** A whole hour on the program's clock, `hours` from now. */
function wallHoursFromNow(hours: number): Date {
  const d = programWallClock(new Date());
  d.setUTCMinutes(0, 0, 0);
  return new Date(d.getTime() + hours * HOUR);
}

const as = (s: { userId: string } | { id: string }) => {
  actor.value = { id: "userId" in s ? s.userId : s.id };
};

async function scene() {
  const p = await program("Global Admissions");
  const host = await student({ programId: p.id, name: "Aziza Karimova" });
  const guest = await student({ programId: p.id, name: "Bekzod Tursunov" });
  return { p, host, guest };
}

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/interviews", () => {
  it("answers 401 with no user", async () => expect((await GET(new Request("http://test/api/v1/interviews"))).status).toBe(401));

  it("answers 403 inactive to a pending student", async () => {
    const p = await program();
    const pending = await student({ programId: p.id, status: "PENDING" });
    as(pending);
    const res = await GET(new Request("http://test/api/v1/interviews"));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("inactive");
  });

  it("answers a mentor in the actions' words", async () => {
    as(await mentor());
    const res = await GET(new Request("http://test/api/v1/interviews"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only approved students and their mentors can practise interviews.");
  });

  it("lists students of every program, offering a time first, by their own programs", async () => {
    const { p, host, guest } = await scene();
    const other = await program("Imkon");
    const visitor = await student({ programId: other.id, name: "Anvar Visiting" });
    const exchange = await prisma.programExchange.create({
      data: { studentId: visitor.id, fromProgramId: other.id, toProgramId: p.id, minutes: 420, deadline: new Date(Date.now() + 30 * 24 * HOUR), sentById: host.userId },
    });
    await enroll({ studentId: visitor.id, programId: p.id });
    await prisma.studentEnrollment.updateMany({
      where: { studentId: visitor.id, programId: p.id },
      data: { exchangeId: exchange.id },
    });
    await prisma.interviewSlot.create({
      data: { userId: guest.userId, startsAt: wallHoursFromNow(30), minutes: 45, meetingUrl: "https://meet.example/x" },
    });

    as(host);
    const body = await (await GET(new Request("http://test/api/v1/interviews"))).json();

    expect(body.classmates.map((c: { person: { name: string } }) => c.person.name)).toEqual([
      "Bekzod Tursunov",
      "Anvar Visiting",
    ]);
    // Each by their user id, the id of their people page, as the website links them.
    expect(body.classmates[0]).toMatchObject({ id: guest.userId, open: 1, programs: [p.name] });
    // The program they are only visiting is not theirs.
    expect(body.classmates[1]).toMatchObject({ id: visitor.userId, open: 0, programs: ["Imkon"] });
    // A classmate's link is for whoever books the time.
    expect(JSON.stringify(body)).not.toContain("meet.example");
    expect(JSON.stringify(body)).not.toContain("@");
    expect(body.zone).toBe("Tashkent");
    expect(body.offer).toMatchObject({ lengths: [30, 45, 60], time: "15:00" });
    expect(body.as).toBe("student");
  });

  it("reads my interviews, my times and the To do on freshform's clock", async () => {
    const { host, guest } = await scene();
    const soon = await prisma.interviewSlot.create({
      data: { userId: host.userId, startsAt: wallHoursFromNow(3), minutes: 45, meetingUrl: "https://meet.example/soon" },
    });
    const past = await prisma.interviewSlot.create({
      data: { userId: host.userId, startsAt: wallHoursFromNow(-3), minutes: 45 },
    });
    const held = await prisma.interviewSlot.create({
      data: { userId: host.userId, startsAt: wallHoursFromNow(-30), minutes: 45 },
    });
    await prisma.interviewSlot.create({ data: { userId: host.userId, startsAt: wallHoursFromNow(80), minutes: 30 } });
    const a = await prisma.peerInterview.create({
      data: { slotId: soon.id, hostId: host.userId, guestId: guest.userId, template: "scholarship" },
    });
    const b = await prisma.peerInterview.create({
      data: { slotId: past.id, hostId: host.userId, guestId: guest.userId, template: "behavioral" },
    });
    const c = await prisma.peerInterview.create({
      data: { slotId: held.id, hostId: host.userId, guestId: guest.userId, template: "visa", completedAt: new Date() },
    });

    as(host);
    const body = await (await GET(new Request("http://test/api/v1/interviews"))).json();

    expect(body.coming.map((r: { id: string }) => r.id)).toEqual([b.id, a.id]);
    expect(body.coming[1]).toMatchObject({ hosting: true, phase: "booked", sent: false, partner: { name: "Bekzod Tursunov" } });
    expect(body.coming[0].phase).toBe("to-mark");
    expect(body.done.map((r: { id: string }) => r.id)).toEqual([c.id]);
    expect(body.times.map((t: { interview: unknown }) => t.interview !== null)).toEqual([true, false]);
    expect(body.times[0].meetingUrl).toBe("https://meet.example/soon");
    expect(body.todo).toEqual([
      expect.objectContaining({ interview: c.id, need: "feedback", meetingUrl: null }),
      expect.objectContaining({ interview: b.id, need: "mark" }),
      expect.objectContaining({ interview: a.id, need: "join", meetingUrl: "https://meet.example/soon" }),
    ]);
  });
});
