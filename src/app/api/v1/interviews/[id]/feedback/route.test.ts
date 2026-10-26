import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { programWallClock } from "@/lib/when";
import { program, student } from "@/test/db";

/** The guide: answers, a feedback draft, sending it, and correcting it in the window. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { PUT: answer } = await import("@/app/api/v1/interviews/[id]/answers/[index]/route");
const { PUT: draft, PATCH: edit } = await import("@/app/api/v1/interviews/[id]/feedback/route");
const { POST: submit } = await import("@/app/api/v1/interviews/[id]/feedback/submit/route");

const MINUTE = 60 * 1000;
const wallMinutesFromNow = (m: number) => new Date(programWallClock(new Date()).getTime() + m * MINUTE);

const req = (method: string, body: unknown) => new Request("http://test", { method, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const putAnswer = (id: string, index: string, body: unknown) =>
  answer(req("PUT", body), { params: Promise.resolve({ id, index }) });
const as = (s: { userId: string }) => {
  actor.value = { id: s.userId };
};

const full = { summary: "Clear answers.", wentWell: "Good examples.", toImprove: "Slow down." };

let programs = 0;

async function scene(startedMinutesAgo = 10) {
  const p = await program(`Global Admissions ${++programs}`);
  const host = await student({ programId: p.id, name: "Aziza Karimova" });
  const guest = await student({ programId: p.id, name: "Bekzod Tursunov" });
  const slot = await prisma.interviewSlot.create({
    data: { userId: host.userId, startsAt: wallMinutesFromNow(-startedMinutesAgo), minutes: 45 },
  });
  const interview = await prisma.peerInterview.create({
    data: { slotId: slot.id, hostId: host.userId, guestId: guest.userId, template: "scholarship" },
  });
  return { p, host, guest, interview };
}

beforeEach(() => {
  actor.value = null;
});

describe("PUT /api/v1/interviews/:id/answers/:index", () => {
  it("saves my answer, and the latest text wins", async () => {
    const { guest, interview } = await scene();
    as(guest);
    expect((await putAnswer(interview.id, "0", { text: "First" })).status).toBe(200);
    expect((await putAnswer(interview.id, "0", { text: "Second" })).status).toBe(200);
    const rows = await prisma.interviewAnswer.findMany({ where: { interviewId: interview.id } });
    expect(rows).toEqual([expect.objectContaining({ userId: guest.userId, questionIndex: 0, text: "Second" })]);
  });

  it("refuses before the start, an index that isn't a question, and somebody not in it", async () => {
    const { p, guest, interview } = await scene(-60);
    as(guest);
    const early = await putAnswer(interview.id, "0", { text: "x" });
    expect(early.status).toBe(400);
    expect((await early.json()).error).toBe(
      "The guide opens at the start time and closes once you submit your feedback."
    );
    expect(await (await putAnswer(interview.id, "one", { text: "x" })).json()).toMatchObject({ field: "index" });

    const later = await scene();
    as(later.guest);
    expect((await (await putAnswer(later.interview.id, "99", { text: "x" })).json()).error).toBe(
      "That question isn't in this interview."
    );
    as(await student({ programId: p.id, name: "Charos" }));
    expect((await putAnswer(later.interview.id, "0", { text: "x" })).status).toBe(404);
  });
});

describe("feedback", () => {
  it("keeps a draft mine alone, then sending it completes the interview and tells the partner", async () => {
    const { host, guest, interview } = await scene();
    as(guest);
    expect((await draft(req("PUT", { summary: "Half" }), params(interview.id))).status).toBe(200);
    const row = await prisma.interviewFeedback.findFirstOrThrow({ where: { fromId: guest.userId } });
    expect(row).toMatchObject({ summary: "Half", submittedAt: null });

    const missing = await submit(req("POST", { ...full, toImprove: "  " }), params(interview.id));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ field: "toImprove", error: "Fill in all three boxes before you submit." });

    expect((await submit(req("POST", full), params(interview.id))).status).toBe(200);
    expect((await prisma.peerInterview.findUniqueOrThrow({ where: { id: interview.id } })).completedAt).not.toBeNull();
    expect(await prisma.notification.count({ where: { userId: host.userId, type: "PEER_INTERVIEW_FEEDBACK" } })).toBe(1);

    const again = await submit(req("POST", full), params(interview.id));
    expect(again.status).toBe(400);
  });

  it("corrects sent feedback in the window, and not after it", async () => {
    const { guest, interview } = await scene();
    as(guest);
    await submit(req("POST", full), params(interview.id));
    const fixed = await edit(req("PATCH", { ...full, toImprove: "Slow down a little." }), params(interview.id));
    expect(fixed.status).toBe(200);
    expect((await prisma.interviewFeedback.findFirstOrThrow({ where: { fromId: guest.userId } })).toImprove).toBe("Slow down a little.");

    const old = await scene(120);
    as(old.guest);
    await prisma.interviewFeedback.create({
      data: { interviewId: old.interview.id, fromId: old.guest.userId, ...full, submittedAt: new Date() },
    });
    const late = await edit(req("PATCH", full), params(old.interview.id));
    expect(late.status).toBe(400);
    expect((await late.json()).error).toBe("Feedback can be changed until 30 minutes after the interview ends.");
  });
});
