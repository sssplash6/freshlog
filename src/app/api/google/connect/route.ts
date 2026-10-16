import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { canActAsMentor } from "@/lib/constants";
import { getCurrentUser } from "@/lib/dal";
import { appUrl } from "@/lib/email/send";
import { consentUrl, googleConfigured, STATE_COOKIE } from "@/lib/google";

export const dynamic = "force-dynamic";

/**
 * Send a mentor to Google's consent screen to connect their Calendar and Meet.
 *
 * Gated here and not only by the Settings row that links to it: a route
 * answers anybody who knows its address. A student — who signs in with Google
 * too — is never asked for their calendar.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${appUrl()}/login`);
  if (!canActAsMentor(user) || !googleConfigured()) {
    return NextResponse.redirect(`${appUrl()}/settings`);
  }

  // Ties the answer Google sends back to this browser, so nobody can finish a
  // connection somebody else started.
  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(consentUrl(state, user.email));
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google",
    maxAge: 10 * 60,
  });
  return response;
}
