import { describe, expect, it } from "vitest";

import { matchNav, normalizeQuery, rankPeople } from "@/lib/command-search";
import { searchFor } from "@/lib/search";
import { prisma } from "@/lib/prisma";
import {
  admin,
  enroll,
  grant,
  mentor,
  pairing,
  platformAdmin,
  program,
  student,
} from "@/test/db";

/**
 * The command palette finds people the reader could already find — never more.
 *
 * It is a second door onto the roster, and a second door is exactly where a
 * scope rule gets forgotten: the students list narrows by grant or by reach,
 * and a search that skipped either would hand the whole school to anybody
 * who pressed ⌘K.
 */

describe("rankPeople", () => {
  const people = [
    { name: "Nazarbek", email: "n@x.test" },
    { name: "Aziza", email: "a@x.test" },
    { name: "Bek Azimov", email: "b@x.test" },
  ];

  it("puts a name that starts with the query above one that contains it", () => {
    expect(rankPeople(people, "az").map((p) => p.name)).toEqual([
      "Aziza",
      "Bek Azimov",
      "Nazarbek",
    ]);
  });

  it("keeps the incoming order within a tier, and caps the list", () => {
    // "z" is inside every name and at the start of none.
    expect(rankPeople(people, "z", 2).map((p) => p.name)).toEqual([
      "Nazarbek",
      "Aziza",
    ]);
  });

  it("matches the email when there is no name", () => {
    const [first] = rankPeople(
      [{ name: "Zed", email: "q@x.test" }, { name: null, email: "zara@x.test" }],
      "zar"
    );
    expect(first.email).toBe("zara@x.test");
  });
});

describe("matchNav", () => {
  const items = [
    { href: "/students", label: "Students" },
    { href: "/sessions", label: "Sessions" },
    { href: "/programs/1", label: "Global Admissions" },
  ];

  it("keeps every item for an empty query", () => {
    expect(matchNav(items, "  ")).toHaveLength(3);
  });

  it("matches the start of any word, case-insensitively", () => {
    expect(matchNav(items, "ADM").map((i) => i.href)).toEqual(["/programs/1"]);
    expect(matchNav(items, "s").map((i) => i.href)).toEqual(["/students", "/sessions"]);
  });

  it("does not match the middle of a word", () => {
    expect(matchNav(items, "ess")).toEqual([]);
  });
});

describe("normalizeQuery", () => {
  it("trims, and treats blank as nothing asked", () => {
    expect(normalizeQuery("  aziza ")).toBe("aziza");
    expect(normalizeQuery("   ")).toBeNull();
    expect(normalizeQuery(null)).toBeNull();
  });

  it("bounds the length", () => {
    expect(normalizeQuery("a".repeat(500))).toHaveLength(100);
  });
});

describe("searchFor", () => {
  it("answers a student with nothing at all", async () => {
    const s = await student({ name: "Aziza" });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(await searchFor(user, "Aziza")).toBeNull();
  });

  it("answers an admin with no grants with nothing at all", async () => {
    await student({ name: "Aziza" });
    expect(await searchFor(await admin(), "Aziza")).toBeNull();
  });

  it("finds only students in the admin's programs, and names only those programs", async () => {
    const [mine, theirs] = await Promise.all([program("Mine"), program("Theirs")]);
    const both = await student({ name: "Aziza Both", programId: mine.id });
    await enroll({ studentId: both.id, programId: theirs.id });
    await student({ name: "Aziza Elsewhere", programId: theirs.id });
    const a = await admin();
    await grant({ userId: a.id, programId: mine.id });

    const results = await searchFor(a, "aziza");
    expect(results?.students.map((s) => s.name)).toEqual(["Aziza Both"]);
    // Reaching a student is not reading them: the other program's name stays
    // out of the response.
    expect(results?.students[0].programs).toEqual(["Mine"]);
  });

  it("gives a plain mentor the students in their programs, and no mentors", async () => {
    const [mine, theirs] = await Promise.all([program("Mine"), program("Theirs")]);
    const m = await mentor("Aziz Mentor");
    await pairing({ mentorId: m.id, programId: mine.id });
    await student({ name: "Aziza In", programId: mine.id });
    await student({ name: "Aziza Out", programId: theirs.id });

    const results = await searchFor(m, "aziz");
    expect(results?.students.map((s) => s.name)).toEqual(["Aziza In"]);
    expect(results?.mentors).toEqual([]);
  });

  it("finds mentors paired in the admin's scope only", async () => {
    const [mine, theirs] = await Promise.all([program("Mine"), program("Theirs")]);
    const inside = await mentor("Dilnoza In");
    const outside = await mentor("Dilnoza Out");
    await pairing({ mentorId: inside.id, programId: mine.id });
    await pairing({ mentorId: inside.id, programId: theirs.id });
    await pairing({ mentorId: outside.id, programId: theirs.id });
    const a = await admin();
    await grant({ userId: a.id, programId: mine.id });

    const results = await searchFor(a, "dilnoza");
    expect(results?.mentors.map((m) => m.name)).toEqual(["Dilnoza In"]);
    expect(results?.mentors[0].programs).toEqual(["Mine"]);
  });

  it("lets a platform admin find everyone", async () => {
    const [one, two] = await Promise.all([program("One"), program("Two")]);
    await student({ name: "Aziza One", programId: one.id });
    await student({ name: "Aziza Two", programId: two.id });
    const results = await searchFor(await platformAdmin(), "aziza");
    expect(results?.students).toHaveLength(2);
  });
});
