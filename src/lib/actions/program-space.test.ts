import { describe, expect, it, vi } from "vitest";

import { PROGRAM_SPACE } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { admin, grant, platformAdmin, program } from "@/test/db";

/**
 * Whether a program is shown as an institute is a platform admin's call: it
 * reframes the app for everybody who works only in that program, which is not
 * the decision of one person administering it.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { setProgramSpace } = await import("@/lib/actions/programs");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

describe("setProgramSpace", () => {
  it("refuses the program's own admin", async () => {
    const research = await program("Research Program");
    const own = await admin();
    await grant({ userId: own.id, programId: research.id });
    actor.value = own;

    const res = await setProgramSpace(
      null,
      form({ programId: research.id, space: PROGRAM_SPACE.INSTITUTE, spaceName: "Research Institute" })
    );
    expect(res).toEqual({ ok: false, error: "Only a platform admin can do that." });
    const after = await prisma.program.findUniqueOrThrow({ where: { id: research.id } });
    expect(after.space).toBe(PROGRAM_SPACE.PROGRAM);
  });

  it("turns it on with a name, and off again keeping the name for next time", async () => {
    const research = await program("Research Program");
    actor.value = await platformAdmin();

    await setProgramSpace(
      null,
      form({ programId: research.id, space: PROGRAM_SPACE.INSTITUTE, spaceName: " Research Institute " })
    );
    expect(await prisma.program.findUniqueOrThrow({ where: { id: research.id } })).toMatchObject({
      space: PROGRAM_SPACE.INSTITUTE,
      spaceName: "Research Institute",
    });

    const off = await setProgramSpace(null, form({ programId: research.id, space: PROGRAM_SPACE.PROGRAM }));
    expect(off).toMatchObject({ ok: true });
    expect(await prisma.program.findUniqueOrThrow({ where: { id: research.id } })).toMatchObject({
      space: PROGRAM_SPACE.PROGRAM,
      spaceName: "Research Institute",
    });
  });
});
