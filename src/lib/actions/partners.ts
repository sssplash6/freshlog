"use server";

import { Prisma } from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionState } from "@/lib/actions/shared";
import { canActAsMentor } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";
import { normalizeSlug, parseEmailList } from "@/lib/partner-feedback";
import { prisma } from "@/lib/prisma";

/**
 * Platform-admin setup of partner feedback forms. Each action re-checks
 * `platformAdmin` itself: they are reachable directly, and the page's gate is
 * not theirs. Anything that is not a platform admin, and any partner id that
 * does not exist, gets the same "Not allowed." — the answer must not say which
 * partners exist.
 */

const NOT_ALLOWED: ActionState = { ok: false, error: "Not allowed." };
const NAME_MAX = 80;
const INVALID_SHOWN = 5;

async function platformActor() {
  const user = await getCurrentUser();
  return user?.platformAdmin ? user : null;
}

function readName(formData: FormData): { name: string } | { error: ActionState } {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: { ok: false, field: "name", error: "Enter a name." } };
  if (name.length > NAME_MAX) {
    return { error: { ok: false, field: "name", error: "Keep it under 80 characters." } };
  }
  return { name };
}

function refresh(slug: string) {
  revalidatePath("/partners");
  revalidatePath(`/partners/${slug}`);
  revalidatePath(`/partners/${slug}/settings`);
}

export async function createPartner(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  if (!(await platformActor())) return NOT_ALLOWED;

  const named = readName(formData);
  if ("error" in named) return named.error;

  const slug = normalizeSlug(String(formData.get("slug") ?? ""));
  if (!slug) {
    return { ok: false, field: "slug", error: "Use 2–40 lowercase letters, digits or dashes." };
  }

  try {
    await prisma.feedbackPartner.create({ data: { slug, name: named.name } });
  } catch (error) {
    // The unique index is the arbiter, so two admins taking one link at once
    // cannot both win; a read-then-write check could not promise that.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, field: "slug", error: "That link is already used." };
    }
    throw error;
  }

  refresh(slug);
  redirect(`/partners/${slug}/settings`);
}

export async function updatePartner(
  partnerId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  if (!(await platformActor())) return NOT_ALLOWED;
  const partner = await prisma.feedbackPartner.findUnique({ where: { id: partnerId } });
  if (!partner) return NOT_ALLOWED;

  const named = readName(formData);
  if ("error" in named) return named.error;

  await prisma.feedbackPartner.update({
    where: { id: partner.id },
    data: { name: named.name, active: formData.get("active") === "on" },
  });
  refresh(partner.slug);
  return { ok: true, message: "Saved." };
}

export async function addPartnerEmails(
  partnerId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  if (!(await platformActor())) return NOT_ALLOWED;
  const partner = await prisma.feedbackPartner.findUnique({ where: { id: partnerId } });
  if (!partner) return NOT_ALLOWED;

  const { emails, invalid } = parseEmailList(String(formData.get("emails") ?? ""));
  if (emails.length === 0 && invalid.length === 0) {
    return { ok: false, field: "emails", error: "Paste at least one email." };
  }

  const existing = new Set(
    (
      await prisma.partnerStudent.findMany({
        where: { partnerId: partner.id, email: { in: emails } },
        select: { email: true },
      })
    ).map((row) => row.email)
  );
  const fresh = emails.filter((email) => !existing.has(email));
  if (fresh.length > 0) {
    await prisma.partnerStudent.createMany({
      data: fresh.map((email) => ({ partnerId: partner.id, email })),
    });
  }

  const parts: string[] = [];
  if (fresh.length > 0) parts.push(`Added ${fresh.length}.`);
  if (existing.size > 0) parts.push(`${existing.size} already listed.`);
  if (invalid.length > 0) {
    parts.push(`${invalid.length} not valid: ${invalid.slice(0, INVALID_SHOWN).join(", ")}.`);
  }

  refresh(partner.slug);
  return { ok: true, message: parts.join(" ") };
}

export async function removePartnerEmail(
  partnerId: string,
  emailId: string
): Promise<ActionState> {
  if (!(await platformActor())) return NOT_ALLOWED;
  const partner = await prisma.feedbackPartner.findUnique({ where: { id: partnerId } });
  if (!partner) return NOT_ALLOWED;

  // Scoped by partner in the delete itself: an id from another partner's list
  // matches nothing, and answers like any other id that is not here.
  const { count } = await prisma.partnerStudent.deleteMany({
    where: { id: emailId, partnerId: partner.id },
  });
  if (count === 0) return NOT_ALLOWED;

  refresh(partner.slug);
  return { ok: true };
}

export async function setPartnerMentors(
  partnerId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  if (!(await platformActor())) return NOT_ALLOWED;
  const partner = await prisma.feedbackPartner.findUnique({ where: { id: partnerId } });
  if (!partner) return NOT_ALLOWED;

  const asked = [...new Set(formData.getAll("mentorId").map((id) => String(id)).filter(Boolean))];
  const users = asked.length
    ? await prisma.user.findMany({
        where: { id: { in: asked } },
        select: { id: true, role: true, isMentor: true },
      })
    : [];
  const keep = users.filter(canActAsMentor).map((user) => user.id);

  await prisma.$transaction([
    prisma.partnerMentor.deleteMany({ where: { partnerId: partner.id } }),
    prisma.partnerMentor.createMany({
      data: keep.map((mentorId) => ({ partnerId: partner.id, mentorId })),
    }),
  ]);

  refresh(partner.slug);
  return { ok: true, message: "Saved." };
}
