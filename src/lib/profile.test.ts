import { describe, expect, it } from "vitest";

import { canSwitchProfile, homeFor } from "@/lib/profile";
import { canActAsMentor, inStudentLens } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { grant, mentor, program, student } from "@/test/db";

/**
 * The Admin/Mentor switch, for somebody made an admin by a grant.
 *
 * Nothing changes a mentor's `role` when they are granted a program, so the
 * switch cannot ask the role: a mentor who was promoted by a grant is exactly
 * the person it is for.
 */
describe("canSwitchProfile", () => {
  it("offers the switch to a mentor once they hold a grant", async () => {
    const m = await mentor();
    expect(await canSwitchProfile(m)).toBe(false);

    await grant({ userId: m.id, programId: (await program()).id });
    expect(await canSwitchProfile(m)).toBe(true);
  });
});

describe("homeFor", () => {
  it("sends a mentor in the admin lens to the admin home", async () => {
    const m = await mentor();
    expect(homeFor(m, "admin")).toBe("/admin");
    expect(homeFor(m, "mentor")).toBe("/mentor");
  });
});

/**
 * The one exception to "a student is only a student": a STUDENT flagged
 * `isMentor` has two halves, the way a dual-role admin does.
 */
describe("a student who also mentors", () => {
  let n = 0;
  async function studentUser(isMentor: boolean) {
    // One program per student: program names are unique.
    const profile = await student({
      programId: (await program(`Program ${++n}`)).id,
    });
    return prisma.user.update({
      where: { id: profile.userId },
      data: { isMentor },
    });
  }

  it("is a mentor only once flagged", async () => {
    expect(canActAsMentor(await studentUser(false))).toBe(false);
    expect(canActAsMentor(await studentUser(true))).toBe(true);
  });

  it("is offered the switch only once flagged", async () => {
    expect(await canSwitchProfile(await studentUser(false))).toBe(false);
    expect(await canSwitchProfile(await studentUser(true))).toBe(true);
  });

  it("lands on /student, or on /mentor in the mentor lens", async () => {
    const u = await studentUser(true);
    expect(homeFor(u, "admin")).toBe("/student");
    expect(homeFor(u, "mentor")).toBe("/mentor");
  });

  it("is on the student side unless they chose the mentor lens", async () => {
    const flagged = await studentUser(true);
    expect(inStudentLens(flagged, "admin")).toBe(true);
    expect(inStudentLens(flagged, "mentor")).toBe(false);
    // A student with no mentor flag has no other lens to be in.
    expect(inStudentLens(await studentUser(false), "mentor")).toBe(true);
  });

  it("keeps a plain student on /student whatever the lens says", async () => {
    expect(homeFor(await studentUser(false), "mentor")).toBe("/student");
  });
});
