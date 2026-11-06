"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/lib/actions/shared";
import { assertPlatformAdmin } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";
import { readTemplateInput } from "@/lib/interview-templates";
import { prisma } from "@/lib/prisma";

/**
 * Writing the practice-interview templates. Platform admins only: a template
 * is offered to every student in every program, so an admin of one program
 * changing it would change what another program's students practise.
 *
 * There is no delete. A booked interview names its template by id, so a
 * template leaves the picker by being retired and keeps its name and questions
 * for the interviews that already used it.
 */

/** A name another template already has, ignoring capitals: two pickers rows reading the same. */
async function nameTaken(name: string, exceptId?: string): Promise<string | null> {
  const rows = await prisma.interviewTemplate.findMany({ select: { id: true, name: true } });
  const wanted = name.toLowerCase();
  return rows.find((r) => r.id !== exceptId && r.name.toLowerCase() === wanted)?.name ?? null;
}

function revalidate() {
  // The picker, the interview pages and every list that names a template.
  revalidatePath("/", "layout");
}

/** Add a template at the end of the picker. */
export async function createInterviewTemplate(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = assertPlatformAdmin(await getCurrentUser());
  if (denied) return denied;

  const input = readTemplateInput({
    name: formData.get("name"),
    summary: formData.get("summary"),
    questions: formData.get("questions"),
  });
  if (!input.ok) return input;
  const taken = await nameTaken(input.name);
  if (taken) return { ok: false, error: `A template called ${taken} already exists.` };

  const last = await prisma.interviewTemplate.aggregate({ _max: { position: true } });
  await prisma.interviewTemplate.create({
    data: {
      name: input.name,
      summary: input.summary,
      questions: JSON.stringify(input.questions),
      position: (last._max.position ?? -1) + 1,
    },
  });

  revalidate();
  return { ok: true, message: `${input.name} is in the picker now.` };
}

/**
 * Change a template's name, summary or questions. Interviews not yet held ask
 * the new questions; answers already given keep the wording they answered.
 */
export async function updateInterviewTemplate(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = assertPlatformAdmin(await getCurrentUser());
  if (denied) return denied;

  const id = String(formData.get("templateId") ?? "");
  const existing = await prisma.interviewTemplate.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Template not found." };

  const input = readTemplateInput({
    name: formData.get("name"),
    summary: formData.get("summary"),
    questions: formData.get("questions"),
  });
  if (!input.ok) return input;
  const taken = await nameTaken(input.name, id);
  if (taken) return { ok: false, error: `A template called ${taken} already exists.` };

  await prisma.interviewTemplate.update({
    where: { id },
    data: {
      name: input.name,
      summary: input.summary,
      questions: JSON.stringify(input.questions),
    },
  });

  revalidate();
  return { ok: true, message: `Saved ${input.name}.` };
}

/**
 * Take a template out of the picker, or put it back. The last one in the
 * picker cannot be retired: with none, nobody could book a practice interview.
 */
export async function setInterviewTemplateRetired(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const denied = assertPlatformAdmin(await getCurrentUser());
  if (denied) return denied;

  const id = String(formData.get("templateId") ?? "");
  const retire = formData.get("retire") === "1";
  const existing = await prisma.interviewTemplate.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Template not found." };

  if (!retire) {
    await prisma.interviewTemplate.update({ where: { id }, data: { retiredAt: null } });
    revalidate();
    return { ok: true, message: `${existing.name} is back in the picker.` };
  }

  if (existing.retiredAt) return { ok: true, message: `${existing.name} is already retired.` };
  const others = await prisma.interviewTemplate.count({
    where: { retiredAt: null, id: { not: id } },
  });
  if (others === 0) {
    return { ok: false, error: "Keep at least one template in the picker, or nobody can book." };
  }

  await prisma.interviewTemplate.update({ where: { id }, data: { retiredAt: new Date() } });
  revalidate();
  return {
    ok: true,
    message: `${existing.name} is retired. Interviews already booked with it keep it.`,
  };
}
