import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { programWallClock } from "@/lib/when";
import { admin, allocation, grant, mentor, program, student } from "@/test/db";

/** A student's practice interviews, read by a mentor who has worked with them. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/students/[id]/interviews/route");

const read = (id: string) => GET(new Request("http://test"), { params: Promise.resolve({ id }) });
const as = (u: { id: string }) => {
  actor.value = { id: u.id };
};

async function scene() {
  const p = await program("Global Admissions");
  const host = await student({ programId: p.id, name: "Aziza Karimova" });
  const guest = await student({ programId: p.id, name: "Bekzod Tursunov" });
  const startsAt = programWallClock(new Date(Date.now() - 3 * 60 * 60 * 1000));
  const slot = await prisma.interviewSlot.create({ data: { userId: host.userId, startsAt, minutes: 45 } });
  const interview = await prisma.peerInterview.create({
    data: {
      slotId: slot.id,
      hostId: host.userId,
      guestId: guest.userId,
      template: "visa",
      completedAt: new Date(),
      hostNotes: "PARTNER-NOTES",
      guestNotes: "Bekzod's own notes",
    },
  });
  await prisma.interviewAnswer.createMany({
    data: [
      { interviewId: interview.id, userId: host.userId, questionIndex: 0, question: "Q", text: "PARTNER-ANSWER" },
      { interviewId: interview.id, userId: guest.userId, questionIndex: 0, question: "Q", text: "Bekzod's answer" },
    ],
  });
  await prisma.interviewFeedback.createMany({
    data: [
      { interviewId: interview.id, fromId: host.userId, summary: "Sent to Bekzod", wentWell: "a", toImprove: "b", submittedAt: new Date() },
      { interviewId: interview.id, fromId: guest.userId, summary: "DRAFT", wentWell: "c", toImprove: "d" },
    ],
  });
  const m = await mentor("Akmal Karimov");
  await allocation({ studentId: guest.id, mentorId: m.id, minutes: 60, deadlineInDays: -10 });
  return { p, host, guest, interview, m };
}

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/students/:id/interviews", () => {
  it("answers 401 with no user", async () => expect((await read("x")).status).toBe(401));

  it("reads the student's own side for a mentor who has worked with them, even long ago", async () => {
    const { guest, interview, m } = await scene();
    as(m);
    const res = await read(guest.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.student).toEqual({ id: guest.id, userId: guest.userId, name: "Bekzod Tursunov" });
    expect(body.interviews).toEqual([
      expect.objectContaining({
        id: interview.id,
        phase: "completed",
        partner: expect.objectContaining({ name: "Aziza Karimova" }),
        notes: "Bekzod's own notes",
        answers: [{ index: 0, question: "Q", text: "Bekzod's answer" }],
        given: null,
        received: { summary: "Sent to Bekzod", wentWell: "a", toImprove: "b" },
      }),
    ]);
    expect(JSON.stringify(body)).not.toMatch(/PARTNER-|DRAFT|@/);
  });

  it("answers a mentor who never worked with them, an admin and a missing student alike", async () => {
    const { p, guest } = await scene();
    const missing = async () => (await read("c-made-up")).json();
    const stranger = await mentor("Umid Rashidov");
    as(stranger);
    expect((await read(guest.id)).status).toBe(404);
    expect(await (await read(guest.id)).json()).toEqual(await missing());

    const a = await admin("Nodira");
    await grant({ userId: a.id, programId: p.id });
    as(a);
    expect((await read(guest.id)).status).toBe(404);
  });
});
