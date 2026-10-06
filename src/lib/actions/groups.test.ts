import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { isGroupEmail } from "@/lib/groups";
import { platformAdmin, program } from "@/test/db";

const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { createStudents } = await import("@/lib/actions/students");
const { setProgramClassHours } = await import("@/lib/actions/programs");

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const one of Array.isArray(v) ? v : [v]) data.append(k, one);
  }
  return data;
}

describe("a program that logs hours as classes", () => {
  it("is off by default, and adds groups by name once on", async () => {
    const p = await program("Imkon");
    expect(p.classHours).toBe(false);
    actor.value = await platformAdmin();

    await setProgramClassHours(null, form({ programId: p.id, classHours: "on" }));

    const state = await createStudents(
      null,
      form({ programId: p.id, groupName: ["Class A", "class a", "Class B"], folderUrl: ["", "", ""] })
    );

    expect(state).toMatchObject({ ok: true });
    const users = await prisma.user.findMany({
      where: { studentProfile: { enrollments: { some: { programId: p.id } } } },
      orderBy: { name: "asc" },
    });
    expect(users.map((u) => u.name)).toEqual(["Class A", "Class B"]);
    expect(users.every((u) => isGroupEmail(u.email) && !u.weeklyDigest)).toBe(true);
  });
});
