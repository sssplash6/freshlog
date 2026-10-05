import { describe, expect, it } from "vitest";

import { SESSION_ANSWER, SESSION_STATUS } from "@/lib/constants";
import { toSessionEntries, type LoggedSession } from "@/lib/session-entries";

function session(over: Partial<LoggedSession> = {}): LoggedSession {
  return {
    id: "s1",
    minutes: 60,
    date: new Date("2026-10-01T10:00:00Z"),
    attended: true,
    late: false,
    note: "Went through the essay.",
    status: SESSION_STATUS.ACTIVE,
    withinPlan: true,
    studentAnswer: SESSION_ANSWER.CONFIRMED,
    studentRating: 5,
    studentNote: "Really useful.",
    mentor: { id: "m1", name: "Dilnoza", email: "d@example.com" },
    ...over,
  };
}

describe("toSessionEntries feedback", () => {
  it("keeps the student's rating and note by default", () => {
    const [entry] = toSessionEntries([session()]);
    expect(entry.studentRating).toBe(5);
    expect(entry.studentNote).toBe("Really useful.");
  });

  it("drops them from the payload for a mentor reading their own sessions", () => {
    const [entry] = toSessionEntries([session()], { feedback: false });
    expect(entry.studentRating).toBeNull();
    expect(entry.studentNote).toBeNull();
    // Whether the student answered is not feedback, and still travels.
    expect(entry.studentAnswer).toBe(SESSION_ANSWER.CONFIRMED);
  });

  it("keeps a dispute's words, which the mentor is told they will see", () => {
    const [entry] = toSessionEntries(
      [
        session({
          studentAnswer: SESSION_ANSWER.DISPUTED,
          studentRating: null,
          studentNote: "It ran 30 minutes, not 60.",
        }),
      ],
      { feedback: false },
    );
    expect(entry.studentNote).toBe("It ran 30 minutes, not 60.");
  });
});
