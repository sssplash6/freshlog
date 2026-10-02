"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

/**
 * "I have read what's new." Called by the changelog page after it mounts —
 * never during render, and never by a link prefetch — so the dot clears only
 * for somebody who actually opened the page.
 *
 * Quiet when signed out, like `markAllNotificationsRead`: the page is already
 * gated, and a stray call has nothing to write.
 */
export async function markChangelogSeen(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  await prisma.user.update({
    where: { id: user.id },
    data: { changelogSeenAt: new Date() },
  });

  revalidatePath("/", "layout");
}
