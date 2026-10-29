import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { programWallClock } from "@/lib/when";
import { mentor, program, student } from "@/test/db";

/**
 * One practice interview: its read, and cancel, done, absent and notes, run
 * through the actions as the signed-in `actor`. What it pins is that only the
 * reader's side is ever sent, and that not-yours is a missing one.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/interviews/[id]/route");
const { POST: cancel } = await import("@/app/api/v1/interviews/[id]/cancel/route");
const { POST: done } = await import("@/app/api/v1/interviews/[id]/done/route");
const { POST: absent } = await import("@/app/api/v1/interviews/[id]/absent/route");
const { PUT: notes } = await import("@/app/api/v1/interviews/[id]/notes/route");

const HOUR = 60 * 60 * 1000;
function wallHoursFromNow(hours: number): Date {
  const d = programWallClock(new Date());
  d.setUTCMinutes(0, 0, 0);
  return new Date(d.getTime() + hours * HOUR);
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const read = (id: string) => GET(new Request("http://test"), params(id));
const call = (route: typeof done, id: string) => route(new Request("http://test", { method: "POST" }), params(id));
const putNotes = (id: string, body: unknown) =>
  notes(new Request("http://test", { method: "PUT", body: JSON.stringify(body) }), params(id));
const as = (s: { userId: string } | { id: string }) => {
  actor.value = { id: "userId" in s ? s.userId : s.id };
};

async function scene(startsIn = 48, extra: { completedAt?: Date } = {}) {
  const p = await program("Global Admissions");
  const host = await student({ programId: p.id, name: "Aziza Karimova" });
  const guest = await student({ programId: p.id, name: "Bekzod Tursunov" });
  const slot = await prisma.interviewSlot.create({
    data: { userId: host.userId, startsAt: wallHoursFromNow(startsIn), minutes: 45, meetingUrl: "https://meet.example/a" },
  });
  const interview = await prisma.peerInterview.create({
    data: { slotId: slot.id, hostId: host.userId, guestId: guest.userId, template: "scholarship", ...extra },
  });
  return { p, host, guest, slot, interview };
}

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/interviews/:id", () => {
  it("answers 401 with no user; a mentor practises too, so one they aren't in is the same 404", async () => {
    expect((await read("x")).status).toBe(401);
    as(await mentor());
    expect((await read("x")).status).toBe(404);
  });

  it("answers an interview I am not in like one that does not exist", async () => {
    const { p, interview } = await scene();
    as(await student({ programId: p.id, name: "Charos" }));
    const theirs = await read(interview.id);
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toEqual(await (await read("c-made-up")).json());
  });

  it("reads a booked one: the questions, the link, and only Cancel", async () => {
    const { guest, interview } = await scene();
    as(guest);
    const body = await (await read(interview.id)).json();
    expect(body).toMatchObject({
      id: interview.id,
      hosting: false,
      phase: "booked",
      partner: { name: "Aziza Karimova" },
      meetingUrl: "https://meet.example/a",
      absent: null,
      mine: null,
      theirs: null,
      can: { cancel: true, done: false, absent: false, guide: false, notes: false, editFeedback: false, feedback: true },
    });
    expect(body.template.questions.length).toBeGreaterThan(0);
    expect(body.guide.rubric.length).toBe(4);
  });

  it("tells the student a mentor interviews that they write no feedback, as the website's guide leaves it out", async () => {
    const p = await program("Global Admissions");
    const m = await mentor("Dilnoza Karimova");
    const s = await student({ programId: p.id, name: "Aziza Karimova" });
    const slot = await prisma.interviewSlot.create({
      data: { userId: m.id, asMentor: true, startsAt: wallHoursFromNow(48), minutes: 45, meetingUrl: "https://meet.example/m" },
    });
    const interview = await prisma.peerInterview.create({
      data: { slotId: slot.id, hostId: m.id, guestId: s.userId, mentorId: m.id, template: "scholarship" },
    });
    as(s);
    const body = await (await read(interview.id)).json();
    expect(body.can.feedback).toBe(false);
  });

  it("never sends the partner's answers, notes or draft, and sends their feedback once it is sent", async () => {
    const { host, guest, interview } = await scene(-2, { completedAt: new Date() });
    await prisma.peerInterview.update({ where: { id: interview.id }, data: { hostNotes: "HOST-PRIVATE", guestNotes: "mine" } });
    await prisma.interviewAnswer.create({
      data: { interviewId: interview.id, userId: host.userId, questionIndex: 0, question: "Q", text: "HOST-ANSWER" },
    });
    await prisma.interviewAnswer.create({
      data: { interviewId: interview.id, userId: guest.userId, questionIndex: 0, question: "Q", text: "my answer" },
    });
    await prisma.interviewFeedback.create({
      data: { interviewId: interview.id, fromId: host.userId, summary: "HOST-DRAFT", wentWell: "x", toImprove: "y" },
    });

    as(guest);
    const draft = await (await read(interview.id)).json();
    expect(JSON.stringify(draft)).not.toMatch(/HOST-/);
    expect(draft).toMatchObject({ notes: "mine", answers: [{ index: 0, question: "Q", text: "my answer" }], theirs: null });
    expect(draft.can).toMatchObject({ notes: true, guide: true, cancel: false });

    await prisma.interviewFeedback.updateMany({ where: { fromId: host.userId }, data: { submittedAt: new Date() } });
    const sent = await (await read(interview.id)).json();
    expect(sent.theirs).toEqual({ summary: "HOST-DRAFT", wentWell: "x", toImprove: "y" });
    expect(sent.notes).toBe("mine");
  });
});

describe("the interview's writes", () => {
  it("answers not-yours like missing on every write, and changes nothing", async () => {
    const { p, interview } = await scene(-2);
    as(await student({ programId: p.id, name: "Charos" }));
    const missing = await (await call(done, "c-made-up")).json();
    for (const route of [cancel, done, absent]) {
      const res = await call(route, interview.id);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(missing);
    }
    expect((await putNotes(interview.id, { notes: "x" })).status).toBe(404);
    expect(await prisma.peerInterview.findUnique({ where: { id: interview.id } })).toMatchObject({ completedAt: null, absentId: null });
  });

  it("cancels: the time is open again and the partner is told", async () => {
    const { host, guest, slot, interview } = await scene();
    as(guest);
    const res = await call(cancel, interview.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await prisma.peerInterview.count()).toBe(0);
    expect(await prisma.interviewSlot.findUnique({ where: { id: slot.id } })).not.toBeNull();
    expect(await prisma.notification.count({ where: { userId: host.userId, type: "PEER_INTERVIEW_CANCELLED" } })).toBe(1);
  });

  it("refuses done before the start, in the action's words", async () => {
    const { guest, interview } = await scene();
    as(guest);
    const res = await call(done, interview.id);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("You can mark it done once the interview has started.");
  });

  it("marks done once it has started, and then notes can be kept", async () => {
    const { guest, interview } = await scene(-2);
    as(guest);
    expect((await putNotes(interview.id, { notes: "early" })).status).toBe(400);
    expect((await call(done, interview.id)).status).toBe(200);
    expect((await putNotes(interview.id, { notes: "  Talked too fast.  " })).status).toBe(200);
    expect(await prisma.peerInterview.findUnique({ where: { id: interview.id } })).toMatchObject({ guestNotes: "Talked too fast." });
    expect(await (await putNotes(interview.id, { notes: 5 })).json()).toMatchObject({ field: "notes" });
  });

  it("marks the partner absent, says who, and tells them", async () => {
    const { host, guest, interview } = await scene(-2);
    as(host);
    expect((await call(absent, interview.id)).status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: guest.userId, type: "PEER_INTERVIEW_ABSENT" } })).toBe(1);
    expect((await (await read(interview.id)).json()).absent).toBe("partner");
    as(guest);
    const theirs = await (await read(interview.id)).json();
    expect(theirs).toMatchObject({ phase: "absent", absent: "me", can: { cancel: false, done: false, guide: false } });
  });
});
