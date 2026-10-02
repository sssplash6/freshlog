"use server";

import { revalidatePath } from "next/cache";

import { readChangelog, snapshotChangelog } from "@/lib/changelog";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

/**
 * "I have read what's new." Called by the changelog page after it mounts —
 * never during render, and never by a link prefetch — so the dot clears only
 * for somebody who actually opened the page.
 *
 * It records WHAT the changelog held, not just the time — see `isUnseen` for
 * why a time cannot say whether an entry was read.
 *
 * Quiet when signed out, like `markAllNotificationsRead`: the page is already
 * gated, and a stray call has nothing to write.
 */
export async function markChangelogSeen(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      changelogSeenAt: new Date(),
      changelogSeen: snapshotChangelog(await readChangelog()),
    },
  });

  revalidatePath("/", "layout");
}
