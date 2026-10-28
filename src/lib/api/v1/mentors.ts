import "server-only";

import { NOT_YOUR_PROGRAM } from "@/lib/api/v1/admin-gates";
import { refused } from "@/lib/api/v1/respond";
import type { Reader } from "@/lib/api/v1/sessions";
import { isText } from "@/lib/api/v1/session-forms";
import type { MentorRegistration } from "@/lib/api/v1/types";
import { scopeCovers } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

/**
 * Registering a mentor from the freshlog app: the body as `createMentor`'s
 * FormData, with every target the body names gated before the action is asked.
 *
 * The action gates each target's program too, but answers a program outside
 * the reader's scope and a level that does not exist in different words, both
 * as a 400. So each target's program is found first: a target outside what the
 * reader reads is a 404, as a missing one is, and one they read and may not
 * change is a 403.
 */

type Target = MentorRegistration["targets"][number];

/** The program a target is in, or null when it names nothing there is. */
async function programOfTarget(target: Target): Promise<string | null> {
  if ("program" in target) return (await prisma.program.findUnique({ where: { id: target.program }, select: { id: true } }))?.id ?? null;
  if ("level" in target) return (await prisma.programLevel.findUnique({ where: { id: target.level }, select: { programId: true } }))?.programId ?? null;
  return (await prisma.cohort.findUnique({ where: { id: target.cohort }, select: { programId: true } }))?.programId ?? null;
}

/** One target as the body may give it: one of its three keys, naming an id. */
function isTarget(value: unknown): value is Target {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && ["program", "level", "cohort"].includes(keys[0]) && isText((value as Record<string, unknown>)[keys[0]]);
}

/** `createMentor`'s FormData, or the answer to give instead: a bad field, or a target that is not the reader's. */
export async function registrationForm(reader: Reader, body: Record<string, unknown>): Promise<FormData | Response> {
  const bad = (field: string) => refused("That isn't a valid value.", 400, { field });
  const { firstName, lastName, email, targets } = body as Partial<Record<keyof MentorRegistration, unknown>>;
  if (!isText(firstName) || !firstName.trim()) return bad("firstName");
  if (!isText(lastName) || !lastName.trim()) return bad("lastName");
  if (!isText(email) || !email.trim()) return bad("email");
  if (!Array.isArray(targets) || targets.length === 0 || !targets.every(isTarget)) return bad("targets");

  const form = new FormData();
  for (const target of targets) {
    const programId = await programOfTarget(target);
    if (!programId || !scopeCovers(reader.read, programId)) return refused("Not found.", 404);
    if (!scopeCovers(reader.write, programId)) return refused(NOT_YOUR_PROGRAM, 403);
    form.append("targets", "program" in target ? `p:${target.program}` : "level" in target ? `l:${target.level}` : `c:${target.cohort}`);
  }
  form.set("email", email);
  form.set("firstName", firstName);
  form.set("lastName", lastName);
  return form;
}
