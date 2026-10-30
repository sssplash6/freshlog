import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { mentor, program, student } from "@/test/db";

/**
 * A student may dictate, but only the notes on a practice interview they are
 * one of the two people in. The endpoint spends money per call, so "has a
 * student account" is not enough.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
const heard = vi.hoisted(() => ({ calls: [] as { names: string[]; kind: string }[] }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));
vi.mock("@/lib/dictation", () => ({
  MAX_AUDIO_BYTES: 5 * 1024 * 1024,
  dictateNote: async (_audio: Blob, names: string[], kind: string) => {
    heard.calls.push({ names, kind });
    return { ok: true, text: "Notes." };
  },
}));

const { POST } = await import("@/app/api/notes/dictate/route");

function post(fields: Record<string, string>) {
  const body = new FormData();
  body.append("audio", new Blob(["x"]), "note.wav");
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return POST(new Request("http://test/api/notes/dictate", { method: "POST", body }));
}

async function scene() {
  const p = await program();
  const host = await student({ programId: p.id, name: "Aziza" });
  const guest = await student({ programId: p.id, name: "Bekzod" });
  const slot = await prisma.interviewSlot.create({
    data: { userId: host.userId, startsAt: new Date("2026-01-01T10:00:00Z"), minutes: 45 },
  });
  const interview = await prisma.peerInterview.create({
    data: { slotId: slot.id, hostId: host.userId, guestId: guest.userId, template: "visa" },
  });
  return { p, host, guest, interview };
}

describe("POST /api/notes/dictate, as a student", () => {
  it("transcribes notes on their own interview, hinting the classmate's name", async () => {
    const { guest, interview } = await scene();
    actor.value = { id: guest.userId };
    heard.calls = [];

    const response = await post({ interviewId: interview.id });

    expect(response.status).toBe(200);
    expect(heard.calls).toEqual([{ names: ["Aziza"], kind: "interview" }]);
  });

  it("refuses without an interview of theirs", async () => {
    const { p, interview } = await scene();
    const stranger = await student({ programId: p.id });
    actor.value = { id: stranger.userId };
    heard.calls = [];

    expect((await post({ interviewId: interview.id })).status).toBe(403);
    expect((await post({})).status).toBe(403);
    expect(heard.calls).toEqual([]);
  });

  it("writes an answer down word for word when asked for one", async () => {
    const { host, interview } = await scene();
    actor.value = { id: host.userId };
    heard.calls = [];

    const response = await post({ interviewId: interview.id, purpose: "answer" });

    expect(response.status).toBe(200);
    expect(heard.calls).toEqual([{ names: ["Bekzod"], kind: "answer" }]);
  });

  it("still refuses an answer on somebody else's interview", async () => {
    const { p, interview } = await scene();
    const stranger = await student({ programId: p.id });
    actor.value = { id: stranger.userId };
    heard.calls = [];

    expect((await post({ interviewId: interview.id, purpose: "answer" })).status).toBe(403);
    expect(heard.calls).toEqual([]);
  });
});

describe("POST /api/notes/dictate, as a mentor", () => {
  /** A practice interview a mentor gave one of their students: the mentor is the interviewer. */
  async function mentorScene() {
    const p = await program();
    const m = await mentor("Akmal Karimov");
    const s = await student({ programId: p.id, name: "Dilnoza" });
    const slot = await prisma.interviewSlot.create({
      data: { userId: m.id, asMentor: true, startsAt: new Date("2026-01-02T10:00:00Z"), minutes: 45 },
    });
    const interview = await prisma.peerInterview.create({
      data: { slotId: slot.id, hostId: m.id, guestId: s.userId, mentorId: m.id, template: "visa" },
    });
    return { m, interview };
  }

  it("transcribes notes on a practice interview they gave as interview notes, hinting the student's name", async () => {
    const { m, interview } = await mentorScene();
    actor.value = { id: m.id };
    heard.calls = [];

    const response = await post({ interviewId: interview.id });

    expect(response.status).toBe(200);
    expect(heard.calls).toEqual([{ names: ["Dilnoza"], kind: "interview" }]);
  });

  it("refuses an interview they are not in", async () => {
    const { interview } = await scene();
    const m = await mentor("Umid Rashidov");
    actor.value = { id: m.id };
    heard.calls = [];

    expect((await post({ interviewId: interview.id })).status).toBe(403);
    expect(heard.calls).toEqual([]);
  });

  it("still dictates a session note when no interview is named", async () => {
    const { m } = await mentorScene();
    actor.value = { id: m.id };
    heard.calls = [];

    expect((await post({})).status).toBe(200);
    expect(heard.calls).toEqual([{ names: [], kind: "session" }]);
  });
});
