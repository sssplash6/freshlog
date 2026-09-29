"use server";

import { revalidatePath } from "next/cache";

import { assertPlatformAdmin } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import type { ActionState } from "@/lib/actions/shared";

/**
 * The only place a program-access grant is created, changed or removed.
 *
 * §8.4: one write surface, and it is this one. `STAFF_SEED` used to be how an
 * admin was made, and it could not stop being that until there was somewhere
 * else — a config list re-applied on every boot would restore an admin the
 * owner had just removed, on the next hand deploy, silently.
 *
 * Platform-only, and deliberately so: granting access is the one act that can
 * widen somebody's reach, so it belongs to the people whose reach is already
 * total. A program admin who could grant would be a program admin who could
 * grant themselves another program.
 */

const LEVELS = ["ADMIN", "LEADER", "SALES"] as const;
type Level = (typeof LEVELS)[number];

function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

/** Set one person's role in one program without touching their other grants. */
export async function setProgramGrant(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await getCurrentUser();
  const denied = assertPlatformAdmin(actor);
  if (denied) return denied;

  const programId = String(formData.get("programId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const role = formData.get("role");
  if (!isLevel(role)) return { ok: false, error: "Pick an access level." };

  const [program, person] = await Promise.all([
    prisma.program.findUnique({ where: { id: programId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
  ]);
  if (!program || !person) return { ok: false, error: "That program or person no longer exists." };

  await prisma.programStaff.upsert({
    where: { userId_programId: { userId, programId } },
    update: { role },
    create: { userId, programId, role, createdById: actor!.id },
  });
  revalidatePath(`/programs/${programId}/settings`);
  return {
    ok: true,
    message: `${person.name ?? person.email} is now a ${role === "ADMIN" ? "super admin" : role.toLowerCase()} for ${program.name}.`,
  };
}

/** Remove one person's access to one program. */
export async function removeProgramGrant(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await getCurrentUser();
  const denied = assertPlatformAdmin(actor);
  if (denied) return denied;

  const programId = String(formData.get("programId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  await prisma.programStaff.deleteMany({ where: { programId, userId } });
  revalidatePath(`/programs/${programId}/settings`);
  return { ok: true, message: "Program access removed." };
}

/**
 * Set one person's access across every program at once.
 *
 * The whole set, not one program at a time: an editor that saved per program
 * would let a half-finished edit stand, and "which programs is this person
 * on?" is one question the reader answers by looking at one row.
 */
export async function setProgramAccess(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  const denied = assertPlatformAdmin(actor);
  if (denied) return denied;

  const userId = String(formData.get("userId") ?? "");
  const person = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });
  if (!person) return { ok: false, error: "That person no longer exists." };

  // One checkbox per program, and a level select beside it. A program with no
  // box ticked is a program this person does not administer — which is how
  // access is REMOVED, and why the write is a replacement rather than an upsert
  // of whatever happened to be submitted.
  const wanted = new Map<string, Level>();
  for (const programId of formData.getAll("program").map(String)) {
    const level = formData.get(`level:${programId}`);
    wanted.set(programId, isLevel(level) ? level : "ADMIN");
  }

  const programs = await prisma.program.findMany({ select: { id: true } });
  const known = new Set(programs.map((p) => p.id));
  for (const id of wanted.keys()) {
    if (!known.has(id)) return { ok: false, error: "Unknown program." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.programStaff.deleteMany({
      where: { userId, programId: { notIn: [...wanted.keys()] } },
    });
    for (const [programId, role] of wanted) {
      await tx.programStaff.upsert({
        where: { userId_programId: { userId, programId } },
        update: { role },
        create: { userId, programId, role, createdById: actor!.id },
      });
    }
  });

  revalidatePath("/", "layout");
  const n = wanted.size;
  return {
    ok: true,
    message:
      n === 0
        ? `${person.name ?? person.email} administers no programs now.`
        : `${person.name ?? person.email} administers ${n} program${n === 1 ? "" : "s"}.`,
  };
}

/**
 * The platform flag itself: who may see every program and write these rows.
 *
 * Guarded against emptying the set. A platform with no platform admin has no
 * way to make one — the seed would do it on the next boot, but that is a
 * deploy, and "redeploy to get back in" is not a permission model.
 */
export async function setPlatformAdmin(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  const denied = assertPlatformAdmin(actor);
  if (denied) return denied;

  const userId = String(formData.get("userId") ?? "");
  const on = formData.get("platformAdmin") === "on";

  if (!on) {
    const others = await prisma.user.count({
      where: { platformAdmin: true, id: { not: userId } },
    });
    if (others === 0) {
      return {
        ok: false,
        error: "Somebody has to run the platform. Grant it to someone else first.",
      };
    }
  }

  const person = await prisma.user.update({
    where: { id: userId },
    data: { platformAdmin: on },
    select: { name: true, email: true },
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: on
      ? `${person.name ?? person.email} runs the platform.`
      : `${person.name ?? person.email} no longer runs the platform.`,
  };
}
