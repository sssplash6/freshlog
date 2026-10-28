import { bearerFrom, liveTokenId } from "@/lib/api/tokens";
import { bodyOf } from "@/lib/api/v1/body";
import { inactive, noContent, refused, signInAgain } from "@/lib/api/v1/respond";
import { isText } from "@/lib/api/v1/session-forms";
import type { DeviceRegistration, DeviceRemoval } from "@/lib/api/v1/types";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** What Expo's push service hands a phone: "ExponentPushToken[…]", or the newer "ExpoPushToken[…]". */
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$/;
const PLATFORMS = ["ios", "android"];

/**
 * This phone's push token, for the sign-in the request carries. A token is one
 * phone and app install, so one somebody else registered moves here: the phone
 * changed hands, and the last person's news must stop reaching it. Signing out
 * of it ends the row (`revokeToken`), and so does the sign-in running out.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const bearer = bearerFrom(request.headers.get("authorization"));
  // A cookie-signed request has no sign-in of the app's to tie a phone to.
  const apiTokenId = bearer ? await liveTokenId(bearer) : null;
  if (!apiTokenId) return refused("Sign in on the app to get notifications.", 400);

  const { token, platform } = ((await bodyOf(request)) ?? {}) as Partial<Record<keyof DeviceRegistration, unknown>>;
  if (!isText(token) || !EXPO_TOKEN.test(token)) return refused("That isn't a push token.", 400, { field: "token" });
  if (!isText(platform) || !PLATFORMS.includes(platform)) return refused("Say which platform this is.", 400, { field: "platform" });

  await prisma.deviceToken.upsert({
    where: { token },
    update: { platform, userId: user.id, apiTokenId },
    create: { token, platform, userId: user.id, apiTokenId },
  });
  return noContent();
}

/**
 * Stop pushing to this phone: the app sends it when notifications are turned
 * off or before it signs out. Only the reader's own row goes, and the answer
 * is the same whether there was one, so a token can't be probed.
 */
export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (user.status !== "ACTIVE") return inactive();
  const { token } = ((await bodyOf(request)) ?? {}) as Partial<Record<keyof DeviceRemoval, unknown>>;
  if (!isText(token)) return refused("That isn't a push token.", 400, { field: "token" });
  await prisma.deviceToken.deleteMany({ where: { token, userId: user.id } });
  return noContent();
}
