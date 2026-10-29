import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { programWallClock } from "@/lib/when";
import { admin, grant, mentor, program, student } from "@/test/db";

/** Interview prep: a program's students' practice, who and when only, for whoever administers it. */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { GET } = await import("@/app/api/v1/interviews/prep/route");
const read = () => GET(new Request("http://test/api/v1/interviews/prep"));
const wall = (hours: number) => new Date(programWallClock(new Date()).getTime() + hours * 60 * 60 * 1000);

beforeEach(() => {
  actor.value = null;
});

describe("GET /api/v1/interviews/prep", () => {
  it("splits the program's students' practice as the page does, and says nothing they wrote", async () => {
    const p = await program("Global Admissions");
    const aziz = await student({ programId: p.id, name: "Aziz Tursunov" });
    const malika = await student({ programId: p.id, name: "Malika Rahimova" });
    const interview = async (hours: number, done: boolean, absentId: string | null = null) => {
      const slot = await prisma.interviewSlot.create({ data: { userId: aziz.userId, startsAt: wall(hours), minutes: 45 } });
      return prisma.peerInterview.create({
        data: { slotId: slot.id, hostId: aziz.userId, guestId: malika.userId, template: "behavioral", completedAt: done ? new Date() : null, absentId, guestNotes: "Private words" },
      });
    };
    await interview(48, false);
    const held = await interview(-48, true);
    await interview(-72, false, malika.userId);

    actor.value = { id: (await mentor()).id };
    expect((await read()).status).toBe(404);
    const nodira = await admin("Nodira Aliyeva");
    await grant({ userId: nodira.id, programId: p.id });
    actor.value = { id: nodira.id };
    const body = await (await read()).json();
    expect(body).toMatchObject({ held: 1, minutesHeld: 45, page: 1, pages: 1, total: 2 });
    expect(body.coming).toHaveLength(1);
    expect(body.history.map((r: { id: string; phase: string }) => r.phase)).toEqual(["completed", "absent"]);
    expect(body.history[0]).toMatchObject({ id: held.id, template: { name: expect.any(String) }, people: [{ name: "Aziz Tursunov", student: aziz.id }, { name: "Malika Rahimova", student: malika.id }] });
    expect(body.history[1].absent).toBe("Malika Rahimova");
    expect(body.students.find((s: { student: { id: string } }) => s.student.id === malika.id)).toMatchObject({ held: 1, minutesHeld: 45, upcoming: 1, missed: 1 });
    expect(JSON.stringify(body)).not.toContain("Private words");
  });
});
