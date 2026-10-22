"use server";

import { cookies } from "next/headers";

import type { ActionState } from "@/lib/actions/shared";
import { normalizeEmail } from "@/lib/actions/shared";
import { USER_STATUS } from "@/lib/constants";
import {
  activePartner,
  normalizeSlug,
  parseFeedback,
  passCookieName,
  readPass,
  signPass,
} from "@/lib/partner-feedback";
import { prisma } from "@/lib/prisma";

/**
 * Public actions for a partner school's students. There is no account here, so
 * nothing is gated by a user: the gate is an open partner plus a signed pass
 * for a listed email, and both are asked again on every submit.
 */

const NOT_OPEN = "This form isn't open.";

/** Deleted with the path it was set on, or a browser keeps the old cookie. */
async function clearPass(slug: string) {
  const jar = await cookies();
  jar.delete({ name: passCookieName(slug), path: `/f/${slug}` });
}

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? "");
}

export async function checkPartnerEmail(
  slug: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const partner = await activePartner(slug);
  if (!partner) return { ok: false, error: NOT_OPEN };

  const raw = text(form, "email");
  const email = normalizeEmail(raw);
  const listed = email
    ? await prisma.partnerStudent.findUnique({
        where: { partnerId_email: { partnerId: partner.id, email } },
      })
    : null;
  if (!listed) {
    return {
      ok: false,
      error: `This email isn't on the list for ${partner.name}. Check the address, or ask your coordinator to add it.`,
      field: "email",
      values: { email: raw },
    };
  }

  const pass = signPass(partner.slug, email, new Date());
  const jar = await cookies();
  jar.set(passCookieName(partner.slug), pass.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/f/${partner.slug}`,
    expires: pass.expires,
  });
  return { ok: true };
}

export async function submitPartnerFeedback(
  slug: string,
  kind: "MENTOR" | "SESSION",
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  // `kind` is bound in the browser, so it is the caller's word, not ours.
  if (kind !== "MENTOR" && kind !== "SESSION") return { ok: false, error: NOT_OPEN };
  const partner = await activePartner(slug);
  if (!partner) return { ok: false, error: NOT_OPEN };

  const values: Record<string, string> = {};
  for (const name of ["mentorId", "sessionNumber", "name", "rating", "comment"]) {
    values[name] = text(form, name);
  }

  const jar = await cookies();
  const cookieName = passCookieName(partner.slug);
  const email = readPass(partner.slug, jar.get(cookieName)?.value, new Date());
  const listed = email
    ? await prisma.partnerStudent.findUnique({
        where: { partnerId_email: { partnerId: partner.id, email } },
      })
    : null;
  if (!email || !listed) {
    await clearPass(partner.slug);
    return { ok: false, error: "Enter your email again to continue.", field: "pass", values };
  }

  const parsed = parseFeedback(kind, form);
  if (!parsed.ok) return { ok: false, error: parsed.error, field: parsed.field, values };
  const input = parsed.value;

  if (input.kind === "MENTOR") {
    // The same question the mentor page asks before it lists anybody: ticked
    // AND active. A tick outlives a deactivation, so the tick alone would take
    // a rating the dropdown no longer offers.
    const offered = await prisma.partnerMentor.findFirst({
      where: {
        partnerId: partner.id,
        mentorId: input.mentorId,
        mentor: { status: USER_STATUS.ACTIVE },
      },
    });
    if (!offered) {
      return { ok: false, error: "Pick one of the listed mentors.", field: "mentorId", values };
    }
  }

  await prisma.partnerFeedback.create({
    data:
      input.kind === "MENTOR"
        ? {
            partnerId: partner.id,
            kind: "MENTOR",
            studentEmail: email,
            mentorId: input.mentorId,
            rating: input.rating,
            comment: input.comment,
          }
        : {
            partnerId: partner.id,
            kind: "SESSION",
            studentEmail: email,
            sessionNumber: input.sessionNumber,
            name: input.name,
            rating: input.rating,
            comment: input.comment,
          },
  });
  return { ok: true, message: "Thanks — your feedback was sent." };
}

export async function forgetPartnerEmail(slug: string): Promise<void> {
  // Not activePartner: a student must be able to drop the pass for a form that has since closed.
  const clean = normalizeSlug(slug);
  if (clean) await clearPass(clean);
}
