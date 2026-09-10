"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { parseNameField, parseTelegramField } from "@/lib/actions/shared";
import {
  canSwitchProfile,
  homeFor,
  isProfile,
  PROFILE_COOKIE,
  PROFILE_MAX_AGE,
} from "@/lib/profile";
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  sniffImageType,
} from "@/lib/avatar";
import { type ActionState } from "@/lib/actions/shared";

/**
 * Your own profile: your display name and your picture.
 *
 * All three actions are self-service — the actor is always the subject, never
 * an id from the form — so there is nothing to authorize beyond being signed
 * in. Admins edit OTHER people through updateMentor in actions/mentors.ts,
 * which is a different job with a different audit story.
 *
 * The gate used to be `canActAsMentor`, which meant a student could not fix
 * the spelling of their own name and a non-mentoring admin could not have a
 * picture. Nobody chose that; it followed from these forms first appearing on
 * a mentor page.
 */

/**
 * Switch lens — admin or mentor. Not a change to the person's profile record
 * below, but to which half of the app they are looking through; see
 * `src/lib/profile.ts` for what that does and does not decide.
 *
 * A server action rather than a link, because the lens is a cookie and the
 * switch has to leave you where you are: this writes and revalidates, and the
 * page you were on repaints in the other lens with the same URL. Nothing here
 * grants anything — a lens is emphasis, and every gate in the app ignores it.
 *
 * Silent on refusal. The only ways to reach it are a control shown to people
 * who can switch and a keyboard chord, so a rejection is not a person making a
 * mistake worth telling them about.
 */
export async function setProfile(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !canSwitchProfile(user)) return;

  const next = formData.get("profile");
  if (!isProfile(next)) return;

  (await cookies()).set(PROFILE_COOKIE, next, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: PROFILE_MAX_AGE,
  });
  // The whole layout: the lens decides the sidebar as well as the page.
  revalidatePath("/", "layout");

  // Staying put is the goal, and it is true for every page that is about a
  // student, a mentor or a program. It is not yet true for the two pages that
  // ARE a lens — /admin and /mentor are still separate trees — so switching
  // while standing in the one you just left goes to its counterpart. When the
  // routes stop being role-scoped there is nothing left for this to catch.
  const from = String(formData.get("path") ?? "");
  const left = next === "admin" ? "/mentor" : "/admin";
  if (from === left || from.startsWith(`${left}/`)) {
    redirect(homeFor(user, next));
  }
}

/**
 * Your Telegram handle, which is how a mentor actually reaches you.
 *
 * It was captured once during onboarding and then never editable, so a student
 * who changed their handle — or typed it wrong on the day they signed up — had
 * no way to fix it and no idea that was why nobody was messaging them.
 */
export async function setOwnTelegram(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "Sign in to do that." };

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: actor.id },
    select: { id: true },
  });
  if (!profile) {
    return { ok: false, error: "Only students have a Telegram handle here." };
  }

  const telegram = parseTelegramField(formData.get("telegramUsername"));
  if ("error" in telegram) return { ok: false, error: telegram.error };

  await prisma.studentProfile.update({
    where: { id: profile.id },
    data: { telegramUsername: telegram.value },
  });

  revalidatePath("/", "layout");
  return { ok: true, message: "Telegram saved." };
}

/**
 * Rename yourself. This is the same field mentors first fill in at signup
 * (completeMentorProfile), now editable for the rest of the time — people
 * marry, transliterate their name differently, or just typo it on day one.
 */
export async function updateOwnName(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) {
    return { ok: false, error: "Sign in to do that." };
  }

  const parsed = parseNameField(formData.get("name"), "your");
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const name = parsed.value;
  if (name === actor.name) return { ok: true, message: "No change to save." };

  await prisma.user.update({ where: { id: actor.id }, data: { name } });

  // Their name is on chips in every table across the app.
  revalidatePath("/", "layout");
  return { ok: true, message: "Name saved." };
}

/**
 * Replace your profile picture.
 *
 * Called imperatively rather than through a form action: the browser resizes
 * and re-encodes the chosen file to a small WebP first, so what arrives here is
 * a generated Blob and not the file the person picked.
 *
 * The checks below re-derive everything from the bytes — a resized upload is a
 * convenience, not a guarantee, and this action is reachable directly.
 */
export async function setOwnAvatar(formData: FormData): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) {
    return { ok: false, error: "Sign in to do that." };
  }

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image first." };
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return {
      ok: false,
      error: `That image is too large (${Math.round(AVATAR_MAX_BYTES / 1024)}KB max after resizing).`,
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Trust the bytes, not the upload's Content-Type: this is what gets served
  // back to browsers later.
  const mimeType = sniffImageType(bytes);
  if (!mimeType || !AVATAR_MIME_TYPES.includes(mimeType as (typeof AVATAR_MIME_TYPES)[number])) {
    return { ok: false, error: "That file isn't a PNG, JPEG, or WebP image." };
  }

  const uploadedAt = new Date();
  await prisma.$transaction([
    prisma.avatarImage.upsert({
      where: { userId: actor.id },
      update: { bytes, mimeType },
      create: { userId: actor.id, bytes, mimeType },
    }),
    // Flips the chips over to the image and busts the cached URL in one write.
    prisma.user.update({
      where: { id: actor.id },
      data: { avatarUpdatedAt: uploadedAt },
    }),
  ]);

  revalidatePath("/", "layout");
  return { ok: true, message: "Picture updated." };
}

/** Drop your picture and go back to the initials badge. */
export async function removeOwnAvatar(): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) {
    return { ok: false, error: "Sign in to do that." };
  }
  if (!actor.avatarUpdatedAt) {
    return { ok: true, message: "You don't have a picture set." };
  }

  await prisma.$transaction([
    prisma.avatarImage.deleteMany({ where: { userId: actor.id } }),
    prisma.user.update({
      where: { id: actor.id },
      data: { avatarUpdatedAt: null },
    }),
  ]);

  revalidatePath("/", "layout");
  return { ok: true, message: "Picture removed." };
}
