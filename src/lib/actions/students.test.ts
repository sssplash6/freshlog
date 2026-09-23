import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { admin, grant, mentor, program, student } from "@/test/db";

/**
 * The one allocation an admin may not touch is the one that pays them.
 *
 * A mentor who also administers the program reaches the same forms as every
 * other admin — but a grant they write to their own name is a pay rise they
 * signed themselves, so the action refuses it whoever asks. Somebody else
 * with scope has to hold the pen.
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
  it("refuses a grant the admin would be paying to themselves", async () => {
    const prog = await program("Imkon");
    const boss = await mentorAdmin("Boss", prog.id);
    const malika = await student({ programId: prog.id });
    actor.value = boss;

    const state = await setMentorAllocation(
      null,
      form({
        studentProfileId: malika.id,
        programId: prog.id,
        mentorId: boss.id,
        minutes: "240",
        deadline: USE_BY,
      })
    );

    expect(state).toMatchObject({ ok: false });
    await expect(prisma.hourAllocation.count()).resolves.toBe(0);
  });

  it("still lets the same admin grant to anybody else", async () => {
    const prog = await program("Imkon");
    const boss = await mentorAdmin("Boss", prog.id);
    const aziza = await mentor("Aziza Rustamova");
    const malika = await student({ programId: prog.id });
    actor.value = boss;

    const state = await setMentorAllocation(
      null,
      form({
        studentProfileId: malika.id,
        programId: prog.id,
        mentorId: aziza.id,
        minutes: "240",
        deadline: USE_BY,
      })
    );

    expect(state).toMatchObject({ ok: true });
  });

  it("refuses to remove the admin's own allocation", async () => {
    const prog = await program("Imkon");
    const boss = await mentorAdmin("Boss", prog.id);
    const colleague = await mentorAdmin("Colleague", prog.id);
    const malika = await student({ programId: prog.id });

    // Somebody else granted the hours — the row exists legitimately.
    actor.value = colleague;
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

    actor.value = boss;
    const refused = await removeMentorAllocation(
      null,
      form({
        studentProfileId: malika.id,
        programId: prog.id,
        mentorId: boss.id,
      })
    );
    expect(refused).toMatchObject({ ok: false });
    await expect(prisma.hourAllocation.count()).resolves.toBe(1);

    // And the same row is removable by the colleague who holds the pen.
    actor.value = colleague;
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
  });

  it("leaves the unassigned pool to any admin, including a mentor-admin", async () => {
    const prog = await program("Imkon");
    const boss = await mentorAdmin("Boss", prog.id);
    const malika = await student({ programId: prog.id });
    actor.value = boss;

    const state = await setMentorAllocation(
      null,
      form({
        studentProfileId: malika.id,
        programId: prog.id,
        mentorId: "",
        minutes: "240",
        deadline: USE_BY,
      })
    );

    expect(state).toMatchObject({ ok: true });
  });
});
