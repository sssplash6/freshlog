import { describe, expect, it } from "vitest";

import { PROGRAM_SPACE } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { soleInstitute, spaceOf } from "@/lib/space";
import {
  admin,
  enroll,
  grant,
  inDays,
  level,
  mentor,
  pairing,
  platformAdmin,
  program,
  student,
} from "@/test/db";

/**
 * The frame follows reach: one institute and nothing else, or the school.
 * One case per row of the table in the design, because each is a different
 * one of the three facts the frame is read from.
 */

async function school() {
  const research = await prisma.program.update({
    where: { id: (await program("Research Program")).id },
    data: { space: PROGRAM_SPACE.INSTITUTE, spaceName: "Research Institute" },
  });
  const [emerging, advanced] = await Promise.all([
    level({ programId: research.id, name: "Emerging" }),
    level({ programId: research.id, name: "Advanced" }),
  ]);
  const global = await program("Global Admissions");
  return { research, emerging, advanced, global };
}

/** The user row a student profile belongs to. */
async function userOf(profile: { userId: string }) {
  return prisma.user.findUniqueOrThrow({ where: { id: profile.userId } });
}

/** A visit: `studentId` lent from one program to another, with its membership. */
async function visit(studentId: string, fromProgramId: string, toProgramId: string) {
  const sender = await admin("Sender");
  const exchange = await prisma.programExchange.create({
    data: {
      studentId,
      fromProgramId,
      toProgramId,
      minutes: 420,
      deadline: inDays(30),
      sentById: sender.id,
    },
  });
  await prisma.studentEnrollment.create({
    data: { studentId, programId: toProgramId, exchangeId: exchange.id },
  });
}

describe("soleInstitute", () => {
  const spaces = new Map([
    ["r", PROGRAM_SPACE.INSTITUTE],
    ["g", PROGRAM_SPACE.PROGRAM],
  ]);
  const at = (id: string) => spaces.get(id);

  it("is the institute when it is the only program", () => {
    expect(soleInstitute(["r", "r"], at)).toBe("r");
  });
  it("is nothing for an ordinary program, two programs, or none", () => {
    expect(soleInstitute(["g"], at)).toBeNull();
    expect(soleInstitute(["r", "g"], at)).toBeNull();
    expect(soleInstitute([], at)).toBeNull();
  });
});

describe("spaceOf", () => {
  it("puts a platform admin in the school", async () => {
    await school();
    const owner = await platformAdmin();
    expect(await spaceOf(owner, "admin")).toEqual({ kind: "school" });
  });

  it("puts an admin of an ordinary program in the school", async () => {
    const { global } = await school();
    const a = await admin();
    await grant({ userId: a.id, programId: global.id });
    expect((await spaceOf(a, "admin")).kind).toBe("school");
  });

  it("puts a Research-only admin in the institute, with its name and levels", async () => {
    const { research } = await school();
    const a = await admin();
    await grant({ userId: a.id, programId: research.id });
    expect(await spaceOf(a, "admin")).toEqual({
      kind: "institute",
      programId: research.id,
      colorIndex: expect.any(Number),
      name: "Research Institute",
      levels: [
        { id: expect.any(String), name: "Advanced" },
        { id: expect.any(String), name: "Emerging" },
      ],
    });
  });

  it("falls back to the program's name when the institute has none of its own", async () => {
    const { research } = await school();
    await prisma.program.update({ where: { id: research.id }, data: { spaceName: null } });
    const a = await admin();
    await grant({ userId: a.id, programId: research.id });
    const space = await spaceOf(a, "admin");
    expect(space.kind === "institute" && space.name).toBe("Research Program");
  });

  it("puts an admin of Research and another program in the school", async () => {
    const { research, global } = await school();
    const a = await admin();
    await grant({ userId: a.id, programId: research.id });
    await grant({ userId: a.id, programId: global.id });
    expect((await spaceOf(a, "admin")).kind).toBe("school");
  });

  it("frames a mentor by their pairings, not by a grant they hold in the other lens", async () => {
    const { research, emerging, global } = await school();
    const m = await mentor();
    await pairing({ mentorId: m.id, programId: research.id, levelId: emerging.id });
    expect((await spaceOf(m, "mentor")).kind).toBe("institute");

    await pairing({ mentorId: m.id, programId: global.id });
    expect((await spaceOf(m, "mentor")).kind).toBe("school");
  });

  it("puts a student who studies only in Research in the institute", async () => {
    const { research, advanced } = await school();
    const s = await student({ programId: research.id, levelId: advanced.id });
    expect((await spaceOf(await userOf(s), "admin")).kind).toBe("institute");
  });

  it("keeps a Research student in the institute while they visit Global", async () => {
    const { research, advanced, global } = await school();
    const s = await student({ programId: research.id, levelId: advanced.id });
    await visit(s.id, research.id, global.id);
    expect((await spaceOf(await userOf(s), "admin")).kind).toBe("institute");
  });

  it("puts a student in Research and Global in the school", async () => {
    const { research, advanced, global } = await school();
    const s = await student({ programId: global.id });
    await enroll({ studentId: s.id, programId: research.id, levelId: advanced.id });
    expect((await spaceOf(await userOf(s), "admin")).kind).toBe("school");
  });

  it("leaves a Global student visiting Research in the school", async () => {
    const { research, global } = await school();
    const s = await student({ programId: global.id });
    await visit(s.id, global.id, research.id);
    expect((await spaceOf(await userOf(s), "admin")).kind).toBe("school");
  });
});

describe("navFor in an institute", () => {
  it("gives the institute's admin its levels where the program item was", async () => {
    const { navFor } = await import("@/lib/nav");
    const { research, emerging, advanced } = await school();
    const a = await admin();
    await grant({ userId: a.id, programId: research.id });

    const items = await navFor(a, "admin", await spaceOf(a, "admin"));
    const levels = items.filter((i) => i.group === "Levels");
    expect(levels.map((i) => [i.label, i.href])).toEqual([
      ["All levels", `/programs/${research.id}`],
      ["Advanced", `/programs/${research.id}?level=${advanced.id}`],
      ["Emerging", `/programs/${research.id}?level=${emerging.id}`],
    ]);
    expect(items.some((i) => i.label === "Research Program")).toBe(false);
  });

  it("leaves a platform admin's Programs item alone", async () => {
    const { navFor } = await import("@/lib/nav");
    await school();
    const owner = await platformAdmin();
    const items = await navFor(owner, "admin", await spaceOf(owner, "admin"));
    expect(items.some((i) => i.href === "/programs" && i.label === "Programs")).toBe(true);
    expect(items.some((i) => i.group)).toBe(false);
  });
});
