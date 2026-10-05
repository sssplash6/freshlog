import "server-only";

import { PROGRAM_STATUS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { nextColorIndex } from "@/lib/program-tone";

type ProgramReader = Pick<typeof prisma, "program">;

/**
 * The colour slot a program about to be created should take: the first one no
 * live program holds. Archived programs don't hold a slot — they are off the
 * pickers and the rosters, so a current program may reuse their colour.
 */
export async function pickColorIndex(db: ProgramReader = prisma): Promise<number> {
  const held = await db.program.findMany({
    where: { status: PROGRAM_STATUS.ACTIVE },
    select: { colorIndex: true },
  });
  return nextColorIndex(held.map((p) => p.colorIndex));
}
