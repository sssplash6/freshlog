"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/dal";
import { openToken, revoke } from "@/lib/google";
import { prisma } from "@/lib/prisma";

/**
 * Disconnect the reader's Google Calendar and Meet.
 *
 * Their own connection and nobody else's — there is no id in the form to
 * point at another mentor's. The grant is revoked at Google as well as
 * forgotten here, so disconnecting means Freshlog can no longer read the
 * calendar at all, not merely that it has stopped. Drafts already measured
 * stay until they are logged or age out: they are this mentor's meetings,
 * not Google's.
 */
export async function disconnectGoogle(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  const connection = await prisma.googleConnection.findUnique({ where: { userId: user.id } });
  if (!connection) return;
  await prisma.googleConnection.delete({ where: { userId: user.id } });
  try {
    await revoke(openToken(connection.refreshToken));
  } catch (error) {
    // The key changed or the token is gone already. The row is deleted either
    // way, which is the half of disconnecting that is ours to guarantee.
    console.error("[google] revoke failed:", error);
  }

  revalidatePath("/", "layout");
}
