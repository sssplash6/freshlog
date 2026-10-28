import { describe, expect, it } from "vitest";

import {
  localDay,
  measureMeeting,
  overlapMs,
  roundMinutes,
  union,
  type MeetParticipant,
} from "@/lib/meet-drafts";

/** 13 October 2026, 15:00 Tashkent, plus `m` minutes. */
const at = (m: number) => new Date(Date.UTC(2026, 9, 13, 10, m));
const span = (from: number, to: number) => ({ start: at(from), end: at(to) });

const MENTOR = "mentor-g";
const STUDENT = "student-g";

function measure(
  participants: MeetParticipant[],
  students = [{ profileId: "s1", googleId: STUDENT as string | null }],
  mentorGoogleId: string | null = MENTOR
) {
  return measureMeeting({
    bookedStart: at(0),
    mentorGoogleId,
    conference: span(0, 60),
    participants,
    students,
  });
}

describe("union and overlap", () => {
  it("folds overlapping and touching stretches", () => {
    expect(union([span(30, 40), span(0, 10), span(10, 20), span(35, 50)])).toEqual([
      span(0, 20),
      span(30, 50),
    ]);
  });

  it("counts only the time both were present", () => {
    expect(overlapMs([span(0, 60)], [span(10, 30), span(40, 50)])).toBe(30 * 60_000);
    expect(overlapMs([span(0, 10)], [span(20, 30)])).toBe(0);
  });
});

describe("roundMinutes", () => {
  it("rounds to five and never offers less than five", () => {
    expect(roundMinutes(52 * 60_000)).toBe(50);
    expect(roundMinutes(53 * 60_000)).toBe(55);
    expect(roundMinutes(0)).toBe(5);
  });
});

describe("measureMeeting", () => {
  it("measures a student who came on time", () => {
    expect(
      measure([
        { user: `users/${MENTOR}`, sessions: [span(0, 50)] },
        { user: `users/${STUDENT}`, sessions: [span(2, 52)] },
      ])
    ).toEqual([{ profileId: "s1", minutes: 50, attendance: "ATTENDED" }]);
  });

  it("charges the time together, not the booking, across a dropped connection", () => {
    const [m] = measure([
      { user: `users/${MENTOR}`, sessions: [span(0, 60)] },
      { user: `users/${STUDENT}`, sessions: [span(0, 20), span(25, 35)] },
    ]);
    expect(m.minutes).toBe(30);
    expect(m.attendance).toBe("ATTENDED");
  });

  it("says late once the student joins past the threshold", () => {
    expect(
      measure([
        { user: `users/${MENTOR}`, sessions: [span(0, 60)] },
        { user: `users/${STUDENT}`, sessions: [span(11, 60)] },
      ])[0].attendance
    ).toBe("LATE");
    expect(
      measure([
        { user: `users/${MENTOR}`, sessions: [span(0, 60)] },
        { user: `users/${STUDENT}`, sessions: [span(10, 60)] },
      ])[0].attendance
    ).toBe("ATTENDED");
  });

  it("says absent when an identifiable student never joined, with the mentor's time", () => {
    expect(measure([{ user: `users/${MENTOR}`, sessions: [span(0, 15)] }])).toEqual([
      { profileId: "s1", minutes: 15, attendance: "ABSENT" },
    ]);
  });

  it("recognises the only other person in a one-to-one call as the student", () => {
    const [m] = measure(
      [
        { user: `users/${MENTOR}`, sessions: [span(0, 45)] },
        { user: null, sessions: [span(0, 45)] },
      ],
      [{ profileId: "s1", googleId: null }]
    );
    expect(m).toEqual({ profileId: "s1", minutes: 45, attendance: "ATTENDED" });
  });

  it("leaves attendance blank when it cannot tell who was who", () => {
    const [m] = measure(
      [
        { user: `users/${MENTOR}`, sessions: [span(0, 40)] },
        { user: null, sessions: [span(0, 40)] },
        { user: "users/someone-else", sessions: [span(0, 40)] },
      ],
      [{ profileId: "s1", googleId: null }]
    );
    expect(m).toEqual({ profileId: "s1", minutes: 40, attendance: null });
  });

  it("falls back to the whole call when the mentor's own account is not recorded", () => {
    const [m] = measure(
      [
        { user: "users/unknown-mentor-account", sessions: [span(0, 60)] },
        { user: `users/${STUDENT}`, sessions: [span(0, 35)] },
      ],
      undefined,
      null
    );
    expect(m.minutes).toBe(35);
  });

  it("measures each student in a group call separately", () => {
    const result = measure(
      [
        { user: `users/${MENTOR}`, sessions: [span(0, 60)] },
        { user: "users/a", sessions: [span(0, 60)] },
        { user: "users/b", sessions: [span(20, 60)] },
      ],
      [
        { profileId: "a", googleId: "a" },
        { profileId: "b", googleId: "b" },
        { profileId: "c", googleId: "c" },
      ]
    );
    expect(result).toEqual([
      { profileId: "a", minutes: 60, attendance: "ATTENDED" },
      { profileId: "b", minutes: 40, attendance: "LATE" },
      { profileId: "c", minutes: 60, attendance: "ABSENT" },
    ]);
  });
});

describe("localDay", () => {
  it("keeps the calendar's own date for a late evening meeting", () => {
    expect(localDay("2026-10-13T23:30:00+05:00")?.toISOString()).toBe(
      "2026-10-13T00:00:00.000Z"
    );
    expect(localDay("not a date")).toBeNull();
  });
});
