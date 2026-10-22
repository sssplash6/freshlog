import { issueSignInCode } from "@/lib/api/tokens";
import { allowedRedirect, S256_CHALLENGE } from "@/lib/api/v1/redirects";
import { signIn } from "@/lib/auth";
import { getCurrentUser } from "@/lib/dal";

// Reads the session and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/** The most a state may be. The app's own is far shorter; a longer one is refused, and never echoed back. */
const MAX_STATE = 200;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * What the Continue page is sent with. It is never kept, and never shown inside
 * another page (a tap meant for something else would hand over a code). Its
 * policy lets it style itself and nothing more: it loads, runs and submits
 * nothing, and its one link is a navigation, which a policy does not govern.
 */
const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  ...NO_STORE,
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

/**
 * `uri` with `params` added to its query: after a `?`, or after an `&` when it
 * has a query already. Values are encoded with `encodeURIComponent`, which
 * writes a space as `%20` and so reads the same in every URL parser.
 */
function withParams(uri: string, params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("&");
  return `${uri}${uri.includes("?") ? "&" : "?"}${query}`;
}

/**
 * A 303 to `location`, never kept by a cache. Only an error for the app to read
 * goes this way: a code never rides a redirect. It waits in the Continue page
 * (`continuePage`) until the person taps.
 */
const seeOther = (location: string) =>
  new Response(null, { status: 303, headers: { ...NO_STORE, Location: location } });

/**
 * `text` made safe between tags and inside a double-quoted attribute: each of
 * `& < > " '` becomes a character reference, the way dev-login's page does it.
 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * What a signed-in person sees in place of a redirect that would hand the app
 * its code. It names the account and has one link, to `appAddress`, which carries
 * the code: the code reaches the app only when the person taps Continue.
 *
 * Everything that came from outside is escaped: the name, the email, and the
 * address, which holds whatever printable ASCII the request's redirect did. No
 * script, no refresh, no form, nothing to load; the style is inline, like
 * dev-login's page, because the page's policy allows nothing else.
 */
function continuePage(user: { name: string | null; email: string }, appAddress: string): Response {
  // A name of only spaces is no name (Google can send one, see src/lib/auth.ts),
  // and `??` would keep it.
  const name = user.name?.trim();
  const account = name
    ? `<strong>${escapeHtml(name)}</strong><span>${escapeHtml(user.email)}</span>`
    : `<strong>${escapeHtml(user.email)}</strong>`;
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in to the freshlog app</title>
<style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1a2733}
h1{font-size:1.5rem}.who{margin:1.5rem 0;padding:.75rem 0;border-top:1px solid #e5e6e8;border-bottom:1px solid #e5e6e8;overflow-wrap:anywhere}
.who span{display:block;color:#6b7480;font-size:13px}
.go{display:block;box-sizing:border-box;height:48px;line-height:48px;border-radius:8px;background:#124b84;color:#fff;font-weight:600;text-align:center;text-decoration:none}
.note{color:#6b7480;font-size:13px}</style>
<h1>Sign in to the freshlog app</h1>
<p class="who">${account}</p>
<a class="go" href="${escapeHtml(appAddress)}">Continue</a>
<p class="note">Only continue if you started signing in from the freshlog app.</p>`;
  return new Response(html, { status: 200, headers: PAGE_HEADERS });
}

/**
 * Where the freshlog app begins signing in, and where Google brings it back to.
 *
 * The app opens this in the system sign-in sheet with a PKCE challenge and a
 * state of its own. Signed out, the person goes to Google and returns here, to
 * this very address. Signed in, they get a page that names the account and has
 * one Continue link; that link is what hands the app its one-time code, which it
 * trades for a token at /api/v1/auth/token. The checks come in this order, and
 * each one is about who may be sent what:
 *
 * 1. The redirect must be the app's. Anything else is a 400 as plain text and
 *    nothing is sent: not a code, and not an error either.
 * 2. For the app's own address, a request that is not whole (S256 and a proper
 *    challenge, and a state of up to 200 characters) is answered with an error
 *    in the redirect, the way OAuth does, so the sheet closes with a reason.
 *    This comes before Google, so a request that cannot work never leaves.
 * 3. Then the Continue page, or Google.
 *
 * Why a page and not a redirect. Any app on the phone can claim `freshlog://`,
 * and the challenge is whatever the request carries, so PKCE protects only a
 * sign-in that the real app began. An app that opened this address in a browser
 * the person is signed in to, with a challenge of its own, would be handed a code
 * unseen. So the code waits for a person who sees which account it is and chooses
 * to go on. RFC 8252 §8.6 asks for that: a request is not processed without the
 * user unless the client's identity can be assured, and a custom scheme cannot.
 *
 * Why an Authorization header is not a session. Signed in means the website's
 * cookie, and the sign-in sheet never sends an Authorization header. A token is
 * how the app asks for data; if it could also be traded here for a code, and the
 * code for a fresh token, a stolen token could mint new ones, and ending the
 * phone's sign-in (which ends only the token it sends) would not end them. A
 * request that carries one, of any kind, is treated as signed out.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();

  const url = new URL(request.url);
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const challenge = url.searchParams.get("code_challenge") ?? "";
  const state = url.searchParams.get("state") ?? "";

  if (!allowedRedirect(redirectUri)) {
    return new Response("This sign-in link isn't for freshlog.", {
      status: 400,
      headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // The state is the app's own check that this answer is to its question, so it
  // is handed back whole or not at all: one that is missing, or too long to
  // trust, is left out of the error too.
  const stateUsable = state !== "" && state.length <= MAX_STATE;
  if (
    url.searchParams.get("code_challenge_method") !== "S256" ||
    !S256_CHALLENGE.test(challenge) ||
    !stateUsable
  ) {
    return seeOther(
      withParams(redirectUri, stateUsable ? { error: "invalid_request", state } : { error: "invalid_request" })
    );
  }

  // `getCurrentUser` is bearer-first, so `user` can be the owner of a token. A
  // token is not a website session: only a request with no Authorization header
  // at all counts as signed in here.
  if (user && !request.headers.has("authorization")) {
    const code = await issueSignInCode(user.id, challenge, redirectUri);
    return continuePage(user, withParams(redirectUri, { code, state }));
  }

  // Signing in redirects by throwing (Next's NEXT_REDIRECT), and that throw is
  // the answer, so nothing here may catch it. The way back is a path on this
  // site and not an address: Auth.js only follows one that is on the same origin.
  return signIn("google", { redirectTo: url.pathname + url.search });
}
