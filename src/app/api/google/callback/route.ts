import { NextResponse, type NextRequest } from "next/server";

import { canActAsMentor } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";
import { appUrl } from "@/lib/email/send";
import {
  exchangeCode,
  GoogleError,
  googleConfigured,
  sealToken,
  STATE_COOKIE,
} from "@/lib/google";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Where Google's consent screen returns. Stores the grant and goes back to
 * /settings with one word saying how it went, which the Google row reads.
 */
export async function GET(request: NextRequest) {
  const done = (result: string) => {
    const response = NextResponse.redirect(`${appUrl()}/settings?google=${result}#google`);
    response.cookies.delete({ name: STATE_COOKIE, path: "/api/google" });
    return response;
  };

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${appUrl()}/login`);
  if (!canActAsMentor(user) || !googleConfigured()) return done("failed");

  const params = request.nextUrl.searchParams;
  const state = request.cookies.get(STATE_COOKIE)?.value;
  if (!state || params.get("state") !== state) return done("failed");
  // The mentor pressed Cancel on Google's screen.
  if (params.get("error")) return done("denied");
  const code = params.get("code");
  if (!code) return done("failed");

  try {
    const granted = await exchangeCode(code);
    // The mentor's own account and no other. A connection is read as this
    // person's meetings, and somebody else's calendar would put somebody
    // else's students in their Needs-you list.
    if (granted.email !== user.email.toLowerCase()) return done("wrong-account");

    await prisma.$transaction(async (tx) => {
      await tx.googleConnection.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          googleEmail: granted.email,
          refreshToken: sealToken(granted.refreshToken),
          scope: granted.scope,
        },
        update: {
          googleEmail: granted.email,
          refreshToken: sealToken(granted.refreshToken),
          scope: granted.scope,
          failedAt: null,
          lastError: null,
        },
      });
      // How Meet will name this mentor in their own calls. Same as sign-in
      // records it; set here too so it does not wait for their next sign-in.
      if (!user.googleId) {
        await tx.user.update({ where: { id: user.id }, data: { googleId: granted.googleId } });
      }
    });
    return done("connected");
  } catch (error) {
    console.error("[google] connect failed:", error);
    return done(error instanceof GoogleError && error.reason === "missing-scope" ? "missing-scope" : "failed");
  }
}
