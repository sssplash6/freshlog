import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, grant, program, student } from "@/test/db";

/**
 * A mentor who also administers the program writes their own grant like any
 * other: the ledger's audit trail, not a second admin, is what keeps it honest.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { setMentorAllocation, removeMentorAllocation } = await import(
  "@/lib/actions/students"
);

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const USE_BY = "2026-12-01";

/** An admin who also mentors — the person this guard exists for. */
async function mentorAdmin(name = "Boss", programId?: string) {
  const user = await admin(name);
  await prisma.user.update({ where: { id: user.id }, data: { isMentor: true } });
  if (programId) await grant({ userId: user.id, programId });
  return user;
}

describe("an admin's own hours", () => {
  it("lets a mentor-admin grant and remove their own time", async () => {
    const prog = await program("Imkon");
    const boss = await mentorAdmin("Boss", prog.id);
    const malika = await student({ programId: prog.id });
    actor.value = boss;

    const granted = await setMentorAllocation(
      null,
      form({
        studentProfileId: malika.id,
        programId: prog.id,
        mentorId: boss.id,
        minutes: "240",
        deadline: USE_BY,
      })
    );
    expect(granted).toMatchObject({ ok: true });
    await expect(prisma.hourAllocation.count()).resolves.toBe(1);

    const removed = await removeMentorAllocation(
      null,
      form({
        studentProfileId: malika.id,
        programId: prog.id,
        mentorId: boss.id,
      })
    );
    expect(removed).toMatchObject({ ok: true });
    await expect(prisma.hourAllocation.count()).resolves.toBe(0);

    // The grant is gone; its history is not. Removal is written as a
    // terminal change down to zero, so the History disclosure can still
    // explain where the hours went.
    const trail = await prisma.hourAllotmentChange.findMany({
      where: { studentId: malika.id },
      orderBy: { createdAt: "asc" },
    });
    expect(trail.map((t) => [t.oldMinutes, t.newMinutes])).toEqual([
      [0, 240],
      [240, 0],
    ]);
    expect(trail[1].changedById).toBe(boss.id);
  });
});
