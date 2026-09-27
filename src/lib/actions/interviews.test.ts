import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { toDateInputValue } from "@/lib/format";
import { programWallClock } from "@/lib/when";
import { admin, program, student } from "@/test/db";

/**
 * Students practising interviews on each other.
 *
 * What these pin is who may reach whom — a classmate is somebody sharing one
 * of your OWN programs, never one you are visiting — and that a time is
 * booked once, whoever presses first.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const {
  addInterviewSlot,
  bookInterview,
  cancelInterview,
  markInterviewDone,
  removeInterviewSlot,
  saveInterviewAnswer,
  saveInterviewFeedback,
  saveInterviewNotes,
  submitInterviewFeedback,
} = await import("@/lib/actions/interviews");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const HOUR = 60 * 60 * 1000;

/** A whole hour on the program's clock, `hours` from now. */
function wallHoursFromNow(hours: number): Date {
  const d = programWallClock(new Date());
  d.setUTCMinutes(0, 0, 0);
  return new Date(d.getTime() + hours * HOUR);
}

const as = (s: { userId: string }) => {
  actor.value = { id: s.userId };
};

async function scene() {
  const p = await program("Global Admissions");
  const host = await student({ programId: p.id, name: "Aziza Karimova" });
  const guest = await student({ programId: p.id, name: "Bekzod Tursunov" });
  const slot = await prisma.interviewSlot.create({
    data: { studentId: host.id, startsAt: wallHoursFromNow(48), minutes: 45 },
  });
  return { p, host, guest, slot };
}

/** Book, and hand back the redirect the action ends in. */
async function book(slotId: string, template = "scholarship") {
  try {
    return await bookInterview(null, form({ slotId, template }));
  } catch (error) {
    return { redirected: (error as Error).message };
  }
}

describe("bookInterview", () => {
  it("books a classmate's time and tells them who took it", async () => {
    const { host, guest, slot } = await scene();
    as(guest);

    const result = await book(slot.id);

    const interview = await prisma.peerInterview.findUniqueOrThrow({
      where: { slotId: slot.id },
    });
    expect(result).toEqual({ redirected: `REDIRECT /student/interviews/${interview.id}` });
    expect(interview).toMatchObject({
      hostId: host.id,
      guestId: guest.id,
      template: "scholarship",
      completedAt: null,
    });
    const notice = await prisma.notification.findFirstOrThrow({
      where: { userId: host.userId },
    });
    expect(notice.type).toBe("PEER_INTERVIEW_BOOKED");
    expect(notice.message).toContain("Bekzod Tursunov booked your");
  });

  it("books a time once, however many ask", async () => {
    const { p, slot } = await scene();
    const third = await student({ programId: p.id, name: "Dilnoza" });
    const guest = await prisma.studentProfile.findFirstOrThrow({
      where: { user: { name: "Bekzod Tursunov" } },
    });

    as(guest);
    await book(slot.id);
    as(third);
    const second = await book(slot.id);

    expect(second).toMatchObject({ ok: false });
    expect(await prisma.peerInterview.count()).toBe(1);
  });

  it("refuses a template the product does not offer", async () => {
    const { guest, slot } = await scene();
    as(guest);

    expect(await book(slot.id, "made-up")).toMatchObject({ ok: false });
  });

  it("does not reach a student in a program the reader is not in", async () => {
    const { slot } = await scene();
    const outsider = await student({ programId: (await program("Imkon")).id });
    as(outsider);

    const result = await book(slot.id);

    // The same sentence a missing time gets: an id says nothing about who exists.
    expect(result).toEqual({
      ok: false,
      error: "That time isn't available any more. Pick another.",
    });
    expect(await prisma.peerInterview.count()).toBe(0);
  });

  it("does not make a visiting student a classmate of the host program", async () => {
    const { p, slot } = await scene();
    const home = await program("Imkon");
    const visitor = await student({ programId: home.id, name: "Visitor" });
    const sender = await admin("Sender");
    const exchange = await prisma.programExchange.create({
      data: {
        studentId: visitor.id,
        fromProgramId: home.id,
        toProgramId: p.id,
        minutes: 420,
        deadline: new Date(Date.now() + 30 * 24 * HOUR),
        sentById: sender.id,
      },
    });
    await prisma.studentEnrollment.create({
      data: { studentId: visitor.id, programId: p.id, exchangeId: exchange.id },
    });
    as(visitor);

    expect(await book(slot.id)).toMatchObject({ ok: false });
  });

  it("refuses the student's own time", async () => {
    const { host, slot } = await scene();
    as(host);

    expect(await book(slot.id)).toEqual({ ok: false, error: "That's one of your own times." });
  });

  it("refuses a student still awaiting approval", async () => {
    const { p, slot } = await scene();
    const pending = await student({ programId: p.id, status: "PENDING" });
    as(pending);

    expect(await book(slot.id)).toMatchObject({ ok: false });
  });
});

describe("addInterviewSlot / removeInterviewSlot", () => {
  it("refuses a time that overlaps one already offered", async () => {
    const { host, slot } = await scene();
    as(host);
    const clash = new Date(slot.startsAt.getTime() + 30 * 60 * 1000);

    const result = await addInterviewSlot(
      null,
      form({
        date: toDateInputValue(clash),
        time: clash.toISOString().slice(11, 16),
        minutes: "30",
      })
    );

    expect(result).toEqual({ ok: false, error: "You already have something at that time." });
  });

  it("offers a free time", async () => {
    const { host, slot } = await scene();
    as(host);
    const later = new Date(slot.startsAt.getTime() + 2 * HOUR);

    const result = await addInterviewSlot(
      null,
      form({
        date: toDateInputValue(later),
        time: later.toISOString().slice(11, 16),
        minutes: "60",
      })
    );

    expect(result).toMatchObject({ ok: true });
    expect(await prisma.interviewSlot.count({ where: { studentId: host.id } })).toBe(2);
  });

  it("will not withdraw a time a classmate booked", async () => {
    const { host, guest, slot } = await scene();
    as(guest);
    await book(slot.id);
    as(host);

    const result = await removeInterviewSlot(null, form({ slotId: slot.id }));

    expect(result).toMatchObject({ ok: false });
    expect(await prisma.interviewSlot.count()).toBe(1);
  });

  it("will not withdraw somebody else's time", async () => {
    const { guest, slot } = await scene();
    as(guest);

    expect(await removeInterviewSlot(null, form({ slotId: slot.id }))).toMatchObject({
      ok: false,
    });
  });
});

describe("addInterviewSlot meeting link", () => {
  const tomorrow = () => toDateInputValue(wallHoursFromNow(24));

  it("keeps an https link on the time", async () => {
    const { guest } = await scene();
    as(guest);

    const result = await addInterviewSlot(
      null,
      form({ date: tomorrow(), time: "10:00", minutes: "45", meetingUrl: "https://meet.google.com/abc-defg-hij" })
    );

    expect(result).toMatchObject({ ok: true });
    const slot = await prisma.interviewSlot.findFirstOrThrow({ where: { studentId: guest.id } });
    expect(slot.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("refuses a link that is not https, and stores nothing", async () => {
    const { guest } = await scene();
    as(guest);

    const result = await addInterviewSlot(
      null,
      form({ date: tomorrow(), time: "10:00", minutes: "45", meetingUrl: "javascript:alert(1)" })
    );

    expect(result).toMatchObject({ ok: false });
    expect(await prisma.interviewSlot.count({ where: { studentId: guest.id } })).toBe(0);
  });
});

describe("after booking", () => {
  /** A booked interview whose time has already started. */
  async function heldScene() {
    const s = await scene();
    const past = await prisma.interviewSlot.create({
      data: { studentId: s.host.id, startsAt: wallHoursFromNow(-2), minutes: 45 },
    });
    const interview = await prisma.peerInterview.create({
      data: { slotId: past.id, hostId: s.host.id, guestId: s.guest.id, template: "visa" },
    });
    return { ...s, interview };
  }

  it("cannot be marked done before it starts", async () => {
    const { guest, slot } = await scene();
    as(guest);
    await book(slot.id);
    const interview = await prisma.peerInterview.findUniqueOrThrow({
      where: { slotId: slot.id },
    });

    const result = await markInterviewDone(null, form({ interviewId: interview.id }));

    expect(result).toMatchObject({ ok: false });
  });

  it("is marked done by either student, and keeps the first moment", async () => {
    const { host, guest, interview } = await heldScene();

    as(host);
    expect(await markInterviewDone(null, form({ interviewId: interview.id }))).toMatchObject({
      ok: true,
    });
    const first = await prisma.peerInterview.findUniqueOrThrow({ where: { id: interview.id } });
    as(guest);
    await markInterviewDone(null, form({ interviewId: interview.id }));
    const second = await prisma.peerInterview.findUniqueOrThrow({ where: { id: interview.id } });

    expect(first.completedAt).not.toBeNull();
    expect(second.completedAt).toEqual(first.completedAt);
  });

  it("keeps each student's notes on their own side", async () => {
    const { host, guest, interview } = await heldScene();
    as(guest);

    expect(
      await saveInterviewNotes(null, form({ interviewId: interview.id, notes: "Too early" }))
    ).toMatchObject({ ok: false });

    await markInterviewDone(null, form({ interviewId: interview.id }));
    await saveInterviewNotes(null, form({ interviewId: interview.id, notes: "Nervous on Q2." }));
    as(host);
    await saveInterviewNotes(null, form({ interviewId: interview.id, notes: "Good eye contact." }));

    const after = await prisma.peerInterview.findUniqueOrThrow({ where: { id: interview.id } });
    expect(after.guestNotes).toBe("Nervous on Q2.");
    expect(after.hostNotes).toBe("Good eye contact.");
  });

  it("refuses a student who is not in the interview", async () => {
    const { p, interview } = await heldScene();
    const stranger = await student({ programId: p.id });
    as(stranger);

    expect(await markInterviewDone(null, form({ interviewId: interview.id }))).toEqual({
      ok: false,
      error: "That interview isn't one of yours.",
    });
  });

  it("cancelling opens the time again and tells the other student", async () => {
    const { host, guest, slot } = await scene();
    as(guest);
    await book(slot.id);
    const interview = await prisma.peerInterview.findUniqueOrThrow({
      where: { slotId: slot.id },
    });
    await prisma.notification.deleteMany();

    await expect(
      cancelInterview(null, form({ interviewId: interview.id }))
    ).rejects.toThrow("REDIRECT /student/interviews");

    expect(await prisma.peerInterview.count()).toBe(0);
    expect(await prisma.interviewSlot.count({ where: { id: slot.id } })).toBe(1);
    const notice = await prisma.notification.findFirstOrThrow({
      where: { userId: host.userId },
    });
    expect(notice.type).toBe("PEER_INTERVIEW_CANCELLED");
  });
});

describe("the guide", () => {
  /** An interview that started two hours ago, template Session 1. */
  async function liveScene() {
    const s = await scene();
    const past = await prisma.interviewSlot.create({
      data: { studentId: s.host.id, startsAt: wallHoursFromNow(-2), minutes: 45 },
    });
    const interview = await prisma.peerInterview.create({
      data: { slotId: past.id, hostId: s.host.id, guestId: s.guest.id, template: "freshman-session-1" },
    });
    return { ...s, interview };
  }

  const answer = (interviewId: string, questionIndex: string, text: string) =>
    saveInterviewAnswer(null, form({ interviewId, questionIndex, text }));

  const FULL = { summary: "Talked about books.", wentWell: "Clear examples.", toImprove: "Slow down." };

  it("keeps each student's answer to the same question apart, with its wording", async () => {
    const { host, guest, interview } = await liveScene();
    as(host);
    expect(await answer(interview.id, "0", "Host answer")).toMatchObject({ ok: true });
    as(guest);
    expect(await answer(interview.id, "0", "Guest answer")).toMatchObject({ ok: true });
    await answer(interview.id, "0", "Guest answer, edited");

    const rows = await prisma.interviewAnswer.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.studentId, r.text])).toEqual([
      [host.id, "Host answer"],
      [guest.id, "Guest answer, edited"],
    ]);
    expect(rows[0].question).toMatch(/^What are you reading/);
  });

  it("refuses a question the template does not have", async () => {
    const { host, interview } = await liveScene();
    as(host);
    expect(await answer(interview.id, "4", "x")).toMatchObject({ ok: false });
    expect(await answer(interview.id, "abc", "x")).toMatchObject({ ok: false });
    expect(await answer(interview.id, "", "x")).toMatchObject({ ok: false });
    expect(await answer(interview.id, " ", "x")).toMatchObject({ ok: false });

    expect(await prisma.interviewAnswer.count()).toBe(0);
  });

  it("refuses answers before the interview starts", async () => {
    const { guest, slot } = await scene();
    as(guest);
    await book(slot.id);
    const interview = await prisma.peerInterview.findUniqueOrThrow({ where: { slotId: slot.id } });

    expect(await answer(interview.id, "0", "early")).toMatchObject({ ok: false });
  });

  it("refuses a student who is not in the interview, on every action", async () => {
    const { p, interview } = await liveScene();
    const stranger = await student({ programId: p.id });
    as(stranger);
    const notYours = { ok: false, error: "That interview isn't one of yours." };

    expect(await answer(interview.id, "0", "x")).toEqual(notYours);
    expect(await saveInterviewFeedback(null, form({ interviewId: interview.id, ...FULL }))).toEqual(notYours);
    expect(await submitInterviewFeedback(null, form({ interviewId: interview.id, ...FULL }))).toEqual(notYours);
  });

  it("submits feedback once, completes the interview and tells the partner", async () => {
    const { host, guest, interview } = await liveScene();
    as(guest);
    await saveInterviewFeedback(null, form({ interviewId: interview.id, summary: "draft" }));
    await prisma.notification.deleteMany();

    expect(await submitInterviewFeedback(null, form({ interviewId: interview.id, ...FULL }))).toMatchObject({ ok: true });

    const fb = await prisma.interviewFeedback.findUniqueOrThrow({
      where: { interviewId_fromId: { interviewId: interview.id, fromId: guest.id } },
    });
    expect(fb).toMatchObject({ ...FULL });
    expect(fb.submittedAt).not.toBeNull();
    const done = await prisma.peerInterview.findUniqueOrThrow({ where: { id: interview.id } });
    expect(done.completedAt).not.toBeNull();
    const notice = await prisma.notification.findFirstOrThrow({ where: { userId: host.userId } });
    expect(notice.type).toBe("PEER_INTERVIEW_FEEDBACK");

    // Locked: a second submit and a later draft are both refused, and nothing moves.
    expect(await submitInterviewFeedback(null, form({ interviewId: interview.id, ...FULL, summary: "changed" }))).toMatchObject({ ok: false });
    expect(await saveInterviewFeedback(null, form({ interviewId: interview.id, summary: "changed" }))).toMatchObject({ ok: false });
    expect(await answer(interview.id, "0", "late")).toMatchObject({ ok: false });
    const after = await prisma.interviewFeedback.findUniqueOrThrow({ where: { id: fb.id } });
    expect(after.summary).toBe(FULL.summary);
    expect(after.submittedAt).toEqual(fb.submittedAt);
  });

  it("the second student can still finish after the first submits", async () => {
    const { host, guest, interview } = await liveScene();
    as(guest);
    await submitInterviewFeedback(null, form({ interviewId: interview.id, ...FULL }));
    const firstDone = (await prisma.peerInterview.findUniqueOrThrow({ where: { id: interview.id } })).completedAt;

    as(host);
    expect(await answer(interview.id, "2", "Still answering")).toMatchObject({ ok: true });
    expect(await submitInterviewFeedback(null, form({ interviewId: interview.id, ...FULL }))).toMatchObject({ ok: true });
    const done = await prisma.peerInterview.findUniqueOrThrow({ where: { id: interview.id } });
    expect(done.completedAt).toEqual(firstDone);
  });

  it("refuses to submit feedback with a box left empty", async () => {
    const { guest, interview } = await liveScene();
    as(guest);
    const result = await submitInterviewFeedback(
      null,
      form({ interviewId: interview.id, summary: "Only this" })
    );
    expect(result).toMatchObject({ ok: false });
    expect(await prisma.interviewFeedback.count({ where: { submittedAt: { not: null } } })).toBe(0);
  });

  it("does not let a cancel racing a submit delete the just-submitted feedback", async () => {
    const { host, guest, interview } = await liveScene();
    as(guest);
    expect(
      await submitInterviewFeedback(null, form({ interviewId: interview.id, ...FULL }))
    ).toMatchObject({ ok: true });
    await prisma.notification.deleteMany();

    as(host);
    const result = await cancelInterview(null, form({ interviewId: interview.id }));

    expect(result).toMatchObject({ ok: false });
    expect(await prisma.peerInterview.count({ where: { id: interview.id } })).toBe(1);
    const fb = await prisma.interviewFeedback.findUniqueOrThrow({
      where: { interviewId_fromId: { interviewId: interview.id, fromId: guest.id } },
    });
    expect(fb.submittedAt).not.toBeNull();
    expect(await prisma.notification.count({ where: { type: "PEER_INTERVIEW_CANCELLED" } })).toBe(0);
  });
});
