import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { attentionFor } from "@/lib/attention";
import { sealToken } from "@/lib/google";
import { syncMeetDrafts } from "@/lib/meet-sync";
import { prisma } from "@/lib/prisma";
import { allocation, mentor, pairing, program, student } from "@/test/db";

/**
 * The sync against a Google that answers from a table. Every URL it asks for
 * is matched here, so a request to anything else fails the test loudly
 * instead of reaching the network.
 */

const NOW = new Date("2026-10-13T12:00:00.000Z");
// 15:00–16:00 in Tashkent, booked; the call ran 15:02–15:50.
const EVENT = {
  id: "evt-1",
  status: "confirmed",
  start: { dateTime: "2026-10-13T15:00:00+05:00" },
  end: { dateTime: "2026-10-13T16:00:00+05:00" },
  conferenceData: { conferenceId: "abc-defg-hij", conferenceSolution: { key: { type: "hangoutsMeet" } } },
};

type Fixture = { studentEmail: string; mentorGoogleId: string; studentGoogleId: string };

function fakeGoogle(f: Fixture, opts: { refresh?: "ok" | "revoked" } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if (url.href === "https://oauth2.googleapis.com/token") {
      return opts.refresh === "revoked"
        ? json({ error: "invalid_grant" }, 400)
        : json({ access_token: "access" });
    }
    if (url.pathname === "/calendar/v3/calendars/primary/events") {
      return json({
        items: [
          {
            ...EVENT,
            attendees: [{ email: "mentor@freshman.academy", self: true }, { email: f.studentEmail }],
          },
        ],
      });
    }
    if (url.pathname === "/v2/conferenceRecords") {
      expect(url.searchParams.get("filter")).toContain('space.meeting_code = "abc-defg-hij"');
      return json({
        conferenceRecords: [
          { name: "conferenceRecords/c1", startTime: "2026-10-13T10:01:00Z", endTime: "2026-10-13T10:50:00Z" },
        ],
      });
    }
    if (url.pathname === "/v2/conferenceRecords/c1/participants") {
      return json({
        participants: [
          { name: "conferenceRecords/c1/participants/m", signedinUser: { user: `users/${f.mentorGoogleId}` } },
          { name: "conferenceRecords/c1/participants/s", signedinUser: { user: `users/${f.studentGoogleId}` } },
        ],
      });
    }
    if (url.pathname === "/v2/conferenceRecords/c1/participants/m/participantSessions") {
      return json({ participantSessions: [{ startTime: "2026-10-13T10:01:00Z", endTime: "2026-10-13T10:50:00Z" }] });
    }
    if (url.pathname === "/v2/conferenceRecords/c1/participants/s/participantSessions") {
      return json({ participantSessions: [{ startTime: "2026-10-13T10:02:00Z", endTime: "2026-10-13T10:50:00Z" }] });
    }
    throw new Error(`unexpected request: ${url.href}`);
  });
}

async function setUp() {
  const p = await program("Global Admissions");
  const m = await mentor("Malika Mentor");
  await pairing({ mentorId: m.id, programId: p.id });
  const s = await student({ programId: p.id, name: "Aziza Student" });
  await allocation({ studentId: s.id, programId: p.id, mentorId: m.id, minutes: 600 });
  const [mentorUser, studentUser] = await Promise.all([
    prisma.user.update({ where: { id: m.id }, data: { googleId: "g-mentor" } }),
    prisma.user.update({ where: { id: s.userId }, data: { googleId: "g-student" } }),
  ]);
  await prisma.googleConnection.create({
    data: {
      userId: m.id,
      googleEmail: mentorUser.email,
      refreshToken: sealToken("refresh"),
      scope: "x",
    },
  });
  return {
    program: p,
    mentor: mentorUser,
    student: s,
    fixture: { studentEmail: studentUser.email, mentorGoogleId: "g-mentor", studentGoogleId: "g-student" },
  };
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_CONNECT_CLIENT_ID", "client");
  vi.stubEnv("GOOGLE_CONNECT_CLIENT_SECRET", "secret");
  vi.stubEnv("GOOGLE_TOKEN_KEY", randomBytes(32).toString("base64"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("syncMeetDrafts", () => {
  it("does nothing until Google is configured", async () => {
    vi.stubEnv("GOOGLE_TOKEN_KEY", "");
    expect(await syncMeetDrafts(NOW)).toEqual({ configured: false, mentors: 0, drafts: 0, failed: 0 });
  });

  it("drafts a finished call with the measured minutes, attendance and only program", async () => {
    const { mentor: m, student: s, program: p, fixture } = await setUp();
    vi.stubGlobal("fetch", fakeGoogle(fixture));

    expect(await syncMeetDrafts(NOW)).toMatchObject({ configured: true, drafts: 1, failed: 0 });
    const [draft] = await prisma.meetDraft.findMany();
    expect(draft).toMatchObject({
      mentorId: m.id,
      studentId: s.id,
      programId: p.id,
      eventId: "evt-1",
      minutes: 50,
      attendance: "ATTENDED",
    });
    expect(draft.date.toISOString()).toBe("2026-10-13T00:00:00.000Z");
    expect((await prisma.googleConnection.findUniqueOrThrow({ where: { userId: m.id } })).lastSyncAt)
      .toEqual(NOW);
  });

  it("writes nothing twice when it runs again", async () => {
    const { fixture } = await setUp();
    vi.stubGlobal("fetch", fakeGoogle(fixture));
    await syncMeetDrafts(NOW);
    expect((await syncMeetDrafts(NOW)).drafts).toBe(0);
    expect(await prisma.meetDraft.count()).toBe(1);
  });

  it("skips a meeting the mentor already logged by hand that day", async () => {
    const { mentor: m, student: s, program: p, fixture } = await setUp();
    await prisma.session.create({
      data: {
        studentId: s.id,
        programId: p.id,
        mentorId: m.id,
        minutes: 60,
        date: new Date("2026-10-13T00:00:00.000Z"),
      },
    });
    vi.stubGlobal("fetch", fakeGoogle(fixture));
    expect((await syncMeetDrafts(NOW)).drafts).toBe(0);
  });

  it("drafts a meeting whose only session that day was voided, and not one rescheduled", async () => {
    const { mentor: m, student: s, program: p, fixture } = await setUp();
    const that = { studentId: s.id, programId: p.id, mentorId: m.id, minutes: 60, date: new Date("2026-10-13T00:00:00.000Z") };
    // Voided: nothing of that day is in the ledger.
    const voided = await prisma.session.create({ data: { ...that, status: "VOIDED" } });
    vi.stubGlobal("fetch", fakeGoogle(fixture));
    expect((await syncMeetDrafts(NOW)).drafts).toBe(1);

    // Rescheduled: the mentor has said what became of the meeting.
    await prisma.meetDraft.deleteMany();
    await prisma.session.update({ where: { id: voided.id }, data: { status: "RESCHEDULED" } });
    expect((await syncMeetDrafts(NOW)).drafts).toBe(0);
  });

  it("ignores invited guests who are not students this mentor reaches", async () => {
    const { fixture } = await setUp();
    vi.stubGlobal("fetch", fakeGoogle({ ...fixture, studentEmail: "stranger@example.com" }));
    expect((await syncMeetDrafts(NOW)).drafts).toBe(0);
  });

  it("never puts a meeting code that is not one into Meet's filter", async () => {
    const { fixture } = await setUp();
    const google = fakeGoogle(fixture);
    const crafted = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/calendar/v3/calendars/primary/events") {
        return new Response(
          JSON.stringify({
            items: [
              {
                ...EVENT,
                conferenceData: {
                  conferenceId: 'abc-defg-hij" OR space.meeting_code != "x',
                  conferenceSolution: { key: { type: "hangoutsMeet" } },
                },
                attendees: [{ email: fixture.studentEmail }],
              },
            ],
          }),
          { status: 200 }
        );
      }
      return google(input);
    });
    vi.stubGlobal("fetch", crafted);
    expect((await syncMeetDrafts(NOW)).drafts).toBe(0);
    expect(crafted.mock.calls.some(([u]) => String(u).includes("conferenceRecords"))).toBe(false);
  });

  it("stops reading a mentor whose grant Google refused, and says so", async () => {
    const { mentor: m, fixture } = await setUp();
    vi.stubGlobal("fetch", fakeGoogle(fixture, { refresh: "revoked" }));
    expect(await syncMeetDrafts(NOW)).toMatchObject({ failed: 1, drafts: 0 });
    const connection = await prisma.googleConnection.findUniqueOrThrow({ where: { userId: m.id } });
    expect(connection.failedAt).toEqual(NOW);

    // And the next run does not try them again.
    expect((await syncMeetDrafts(NOW)).mentors).toBe(0);
  });
});

describe("a draft in the mentor's Needs you", () => {
  it("links to the log form pre-filled, and goes once the session is logged", async () => {
    const { mentor: m, student: s, program: p, fixture } = await setUp();
    vi.stubGlobal("fetch", fakeGoogle(fixture));
    await syncMeetDrafts(NOW);

    const before = await attentionFor(m, "mentor");
    const row = before.statuses.find((r) => r.type === "MEETING_TO_LOG");
    expect(row).toBeDefined();
    const href = new URL(row!.href!, "https://x");
    expect(href.pathname).toBe("/sessions/new");
    expect(Object.fromEntries(href.searchParams)).toEqual({
      studentProfileId: s.id,
      programId: p.id,
      minutes: "50",
      date: "2026-10-13",
      attendance: "ATTENDED",
    });
    expect(row!.subject?.name).toBe("Aziza Student");

    await prisma.session.create({
      data: { studentId: s.id, programId: p.id, mentorId: m.id, minutes: 50, date: new Date("2026-10-13T00:00:00.000Z") },
    });
    const after = await attentionFor(m, "mentor");
    expect(after.statuses.some((r) => r.type === "MEETING_TO_LOG")).toBe(false);
  });

  it("stays while the day's only session is voided, and goes once one is rescheduled", async () => {
    const { mentor: m, student: s, program: p, fixture } = await setUp();
    vi.stubGlobal("fetch", fakeGoogle(fixture));
    await syncMeetDrafts(NOW);
    const asks = async () =>
      (await attentionFor(m, "mentor")).statuses.some((r) => r.type === "MEETING_TO_LOG");

    const logged = await prisma.session.create({
      data: { studentId: s.id, programId: p.id, mentorId: m.id, minutes: 50, date: new Date("2026-10-13T00:00:00.000Z") },
    });
    await prisma.session.update({ where: { id: logged.id }, data: { status: "VOIDED" } });
    expect(await asks()).toBe(true);

    await prisma.session.update({ where: { id: logged.id }, data: { status: "RESCHEDULED" } });
    expect(await asks()).toBe(false);
  });

  it("asks a mentor whose connection failed to reconnect", async () => {
    const { mentor: m } = await setUp();
    await prisma.googleConnection.update({ where: { userId: m.id }, data: { failedAt: NOW } });
    const { statuses } = await attentionFor(m, "mentor");
    expect(statuses.find((r) => r.type === "GOOGLE_RECONNECT")?.href).toBe("/settings#google");
  });
});
