import { describe, expect, it } from "vitest";

import { NO_UNREAD, summarizeUnread, unreadLabel } from "@/lib/unread";

describe("summarizeUnread", () => {
  const rows = [
    { category: "SESSIONS", count: 142 },
    { category: "TASKS", count: 11 },
    { category: "DEADLINES", count: 3 },
    { category: "ACCOUNTS", count: 1 },
  ];

  it("keeps the total the badge draws", () => {
    expect(summarizeUnread(rows).total).toBe(157);
  });

  it("puts the deadlines first and the rest by size", () => {
    const { parts, urgent } = summarizeUnread(rows);
    expect(urgent).toBe(3);
    expect(parts.map((p) => p.category)).toEqual([
      "DEADLINES",
      "SESSIONS",
      "TASKS",
      "ACCOUNTS",
    ]);
  });

  it("counts a category it does not know, so the total matches the feed", () => {
    const s = summarizeUnread([...rows, { category: "SOMETHING_NEW", count: 2 }]);
    expect(s.total).toBe(159);
    expect(s.parts.map((p) => p.category)).not.toContain("SOMETHING_NEW");
  });

  it("is empty when nothing is unread", () => {
    expect(summarizeUnread([])).toEqual(NO_UNREAD);
    expect(summarizeUnread([{ category: "TASKS", count: 0 }]).parts).toEqual([]);
  });
});

describe("unreadLabel", () => {
  it("names what is urgent inside the total", () => {
    expect(unreadLabel(summarizeUnread([{ category: "DEADLINES", count: 3 }, { category: "TASKS", count: 4 }]))).toBe(
      "Notifications: 7 unread, 3 of them deadlines"
    );
    expect(unreadLabel(summarizeUnread([{ category: "DEADLINES", count: 1 }]))).toBe(
      "Notifications: 1 unread, 1 of them a deadline"
    );
  });

  it("stays plain when nothing is urgent or nothing is unread", () => {
    expect(unreadLabel(summarizeUnread([{ category: "TASKS", count: 4 }]))).toBe("Notifications: 4 unread");
    expect(unreadLabel(NO_UNREAD)).toBe("Notifications: none unread");
  });
});
