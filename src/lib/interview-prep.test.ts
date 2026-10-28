import { describe, expect, it } from "vitest";

import { interviewsForStaff, prepByStudent } from "@/lib/interview-prep";
import { prisma } from "@/lib/prisma";
import { enroll, program, student } from "@/test/db";

/**
 * Practice interviews on the admin page. Pinned: WHICH interviews a scoped
 * admin sees (those with one of their own students in them), WHAT is selected
 * (no answers, notes or emails), and that only a completed interview counts as
 * time practised.
 */
const NOW = new Date("2026-10-15T12:00:00Z");

async function interview(opts: {
  hostId: string;
  guestId: string;
  startsAt: string;
  minutes?: number;
  completed?: boolean;
  absentId?: string;
}) {
  const slot = await prisma.interviewSlot.create({
    data: { userId: opts.hostId, startsAt: new Date(opts.startsAt), minutes: opts.minutes ?? 45 },
  });
  return prisma.peerInterview.create({
    data: {
      slotId: slot.id,
      hostId: opts.hostId,
      guestId: opts.guestId,
      template: "university-admissions",
      completedAt: opts.completed ? new Date(opts.startsAt) : null,
      absentId: opts.absentId ?? null,
      hostNotes: "host private note",
    },
  });
}

describe("interviewsForStaff", () => {
  it("shows a scoped admin only interviews with one of their own students in them", async () => {
    const ga = await program("Global Admissions");
    const imkon = await program("Imkon");
    const a = await student({ programId: ga.id, name: "Aziza" });
    const b = await student({ programId: ga.id, name: "Bobur" });
    const c = await student({ programId: imkon.id, name: "Dilnoza" });
    const d = await student({ programId: imkon.id, name: "Eldor" });
    await interview({ hostId: a.userId, guestId: b.userId, startsAt: "2026-10-10T10:00:00Z", completed: true });
    await interview({ hostId: c.userId, guestId: d.userId, startsAt: "2026-10-11T10:00:00Z", completed: true });

    const gaRows = await interviewsForStaff([ga.id], NOW);
    expect(gaRows.map((r) => [r.host.name, r.guest.name])).toEqual([["Aziza", "Bobur"]]);

    const all = await interviewsForStaff(undefined, NOW);
    expect(all).toHaveLength(2);
  });

  it("names a partner from another program without counting them as the reader's", async () => {
    const ga = await program("Global Admissions");
    const masters = await program("Master's");
    const a = await student({ programId: ga.id, name: "Aziza" });
    const b = await student({ programId: masters.id, name: "Bobur" });
    await enroll({ studentId: a.id, programId: masters.id });
    await interview({ hostId: a.userId, guestId: b.userId, startsAt: "2026-10-10T10:00:00Z", completed: true });

    const [row] = await interviewsForStaff([ga.id], NOW);
    expect(row.host).toMatchObject({ name: "Aziza", ours: true });
    expect(row.guest).toMatchObject({ name: "Bobur", ours: false, email: "" });
    expect(JSON.stringify(row)).not.toContain("private note");
    expect(prepByStudent([row]).map((s) => s.person.name)).toEqual(["Aziza"]);
  });
});

describe("prepByStudent", () => {
  it("counts only completed interviews as time practised", async () => {
    const p = await program("Global Admissions");
    const a = await student({ programId: p.id, name: "Aziza" });
    const b = await student({ programId: p.id, name: "Bobur" });
    await interview({ hostId: a.userId, guestId: b.userId, startsAt: "2026-10-01T10:00:00Z", minutes: 60, completed: true });
    await interview({ hostId: b.userId, guestId: a.userId, startsAt: "2026-10-03T10:00:00Z", absentId: b.userId });
    await interview({ hostId: a.userId, guestId: b.userId, startsAt: "2026-10-05T10:00:00Z" });
    await interview({ hostId: a.userId, guestId: b.userId, startsAt: "2026-10-20T10:00:00Z" });

    const rows = prepByStudent(await interviewsForStaff([p.id], NOW));
    const aziza = rows.find((r) => r.person.name === "Aziza")!;
    const bobur = rows.find((r) => r.person.name === "Bobur")!;
    expect(aziza).toMatchObject({ held: 1, minutesHeld: 60, upcoming: 1, missed: 0 });
    expect(bobur).toMatchObject({ held: 1, minutesHeld: 60, upcoming: 1, missed: 1 });
    expect(aziza.lastAt).toEqual(new Date("2026-10-05T10:00:00Z"));
  });
});
