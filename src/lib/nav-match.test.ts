import { describe, expect, it } from "vitest";

import type { NavItem } from "@/lib/nav";
import { matchNavItem } from "@/lib/nav-match";

const STUDENT: NavItem[] = [
  { href: "/student", label: "Home" },
  { href: "/student/book", label: "Book" },
  { href: "/student/interviews", label: "Interviews" },
];

const none = new URLSearchParams();

describe("matchNavItem", () => {
  it("lights the longest matching href", () => {
    expect(matchNavItem(STUDENT, "/student", none)?.label).toBe("Home");
    expect(matchNavItem(STUDENT, "/student/book", none)?.label).toBe("Book");
    expect(matchNavItem(STUDENT, "/student/meetings/x", none)?.label).toBe("Home");
    expect(matchNavItem(STUDENT, "/settings", none)).toBeNull();
  });

  it("needs every query parameter an item names", () => {
    const items: NavItem[] = [
      { href: "/programs/p", label: "All levels" },
      { href: "/programs/p?level=a", label: "Level A" },
    ];
    expect(matchNavItem(items, "/programs/p", new URLSearchParams("level=a"))?.label).toBe(
      "Level A"
    );
    expect(matchNavItem(items, "/programs/p", new URLSearchParams("level=b"))?.label).toBe(
      "All levels"
    );
  });

  // The phone tab bar's bug (October 2026): a tap on Book records Book as the
  // pending destination before the click reaches the link. Asked of that
  // pending path, Book is "the tab you are on", so its re-tap handler cancelled
  // the navigation. A re-tap is decided by where the router has landed.
  it("tells a tap in flight from a re-tap", () => {
    const book = STUDENT[1];
    const lit = matchNavItem(STUDENT, "/student/book", none); // pending
    const landed = matchNavItem(STUDENT, "/student", none); // router
    expect(lit).toBe(book);
    expect(landed).not.toBe(book);
  });
});
