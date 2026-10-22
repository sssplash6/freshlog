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
//
// /f is a partner school's feedback form, opened from a Telegram link by
// students who have no account here; its pages authorize on a signed pass
// cookie for a listed email instead (src/lib/partner-feedback.ts).
//
// /api/v1 is the freshlog app's API. The app carries a bearer token, never a
// cookie, so bouncing it to /login would answer a phone with an HTML page. No
// check happens here for it: every handler gates itself on its first line with
// getCurrentUser, except the sign-in routes themselves, auth/token and
// auth/signout, which say so in their own first-line comments, and auth/dev,
// whose first line is the dev-login guard (devLoginEnabled).
const PUBLIC_PATHS = [
  "/login",
  "/unsubscribe",
  "/api/email",
  "/api/dev-login",
  "/api/telegram",
  "/f",
  "/api/v1",
];

/**
 * The one spelling of a partner's link: its slug trimmed and lowercased, the
 * way it is stored. Or null when `pathname` is already that spelling, or is
 * not a partner link.
 *
 * The pages would render /f/KHANA anyway (activePartner normalises), but the
 * pass cookie is set on path /f/khana and browsers match cookie paths
 * case-sensitively. A student on /f/KHANA would check in, never send the
 * cookie back, and be shown the email step forever. Done here rather than in
 * the page so it is a real 307: under the root loading boundary, a page's
 * redirect() arrives after the 200 has been sent.
 */
function canonicalPartnerPath(pathname: string): string | null {
  const link = /^\/f\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!link) return null;
  const [, raw, rest = ""] = link;
  let slug: string;
  try {
    slug = encodeURIComponent(decodeURIComponent(raw).trim().toLowerCase());
  } catch {
    return null; // A malformed escape is the page's 404 to give, not ours.
  }
  return slug && slug !== raw ? `/f/${slug}${rest}` : null;
}

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const canonical = canonicalPartnerPath(pathname);
  if (canonical) {
    const url = req.nextUrl.clone();
    url.pathname = canonical;
    return NextResponse.redirect(url);
  }

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
