import { NextRequest, NextResponse } from "next/server";

// Optimistic auth check only (cookie presence — no DB, no JWT verification).
// Real enforcement lives in the DAL (src/lib/dal.ts): every page and server
// action verifies the session and role server-side.
// Both unsubscribe paths are reached from the footer of a weekly digest, by
// someone who is not signed in and should not have to be to stop receiving
// email. They authorize on a signed token in the URL instead
// (src/lib/email/unsubscribe.ts): /unsubscribe is the human confirm page, and
// /api/email/unsubscribe is the one-click POST that mail clients make.
//
// The API path MUST be listed. Bouncing it to /login would answer a mail
// client's unsubscribe POST with a redirect to a sign-in page, which reads as
// success to the client while nothing was actually turned off.
//
// /api/dev-login is the local-only sign-in (see its route): it answers 404
// unless DEV_LOGIN=1 on a localhost request, so listing it here opens nothing
// anywhere else — it has to be reachable signed-out because signing in is
// what it is for.
//
// /api/telegram is Telegram's webhook, which never carries a session. It
// authorizes on the X-Telegram-Bot-Api-Secret-Token header instead (see its
// route). Telegram does not follow redirects, so a bounce to /login would
// silently drop every message from the group.
const PUBLIC_PATHS = [
  "/login",
  "/unsubscribe",
  "/api/email",
  "/api/dev-login",
  "/api/telegram",
];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSessionCookie =
    req.cookies.has("authjs.session-token") ||
    req.cookies.has("__Secure-authjs.session-token");

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  if (!hasSessionCookie && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  // Deliberately NOT the mirror image of the rule above: a PRESENT cookie is
  // not a VALID session. Bouncing /login → / on mere presence locks anyone out
  // whose cookie can no longer be decrypted (a rotated NEXTAUTH_SECRET, a
  // truncated cookie): / verifies for real, finds nobody, and sends them back
  // to /login, which bounces to / again — an unbreakable loop with no way to
  // sign in. Sending signed-in users away from /login is a convenience, so it
  // belongs where the session is actually verified: app/login/page.tsx.
  return NextResponse.next();
}

export const config = {
  // Everything except the auth endpoints, the cron endpoints (which carry
  // their own CRON_SECRET bearer check), Next internals, and static assets.
  matcher: [
    "/((?!api/auth|api/cron|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
