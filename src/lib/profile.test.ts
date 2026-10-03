import { describe, expect, it } from "vitest";

import { canSwitchProfile, homeFor } from "@/lib/profile";
import { grant, mentor, program } from "@/test/db";

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
