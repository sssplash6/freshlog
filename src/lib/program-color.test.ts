import { describe, expect, it } from "vitest";

import { PROGRAM_STATUS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { pickColorIndex } from "@/lib/program-color";

/** A program with an explicit slot, the way `createProgram` writes one. */
async function withSlot(name: string, colorIndex: number, status: string = PROGRAM_STATUS.ACTIVE) {
  return prisma.program.create({ data: { name, colorIndex, status } });
}

describe("pickColorIndex", () => {
  it("gives a new program a slot no live program holds", async () => {
    await withSlot("Global Admissions", 0);
    await withSlot("Master's Program", 1);
    expect(await pickColorIndex()).toBe(2);
  });

  it("lets a new program reuse an archived program's colour", async () => {
    await withSlot("Global Admissions", 0);
    await withSlot("Old Summer School", 1, PROGRAM_STATUS.ARCHIVED);
    expect(await pickColorIndex()).toBe(1);
  });
});
