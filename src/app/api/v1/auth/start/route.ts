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

/** A 303 to `location`, which carries a code and so is never kept by a cache. */
const seeOther = (location: string) =>
  new Response(null, { status: 303, headers: { ...NO_STORE, Location: location } });

/**
 * Where the freshlog app begins signing in, and where Google brings it back to.
 *
 * The app opens this in the system sign-in sheet with a PKCE challenge and a
 * state of its own. Signed out, the person goes to Google and returns here, to
 * this very address; signed in, they leave with a one-time code, which the app
 * trades for a token at /api/v1/auth/token. The checks come in this order, and
 * each one is about who may be sent what:
 *
 * 1. The redirect must be the app's. Anything else is a 400 as plain text and
 *    nothing is sent: not a code, and not an error either.
 * 2. For the app's own address, a request that is not whole (S256 and a proper
 *    challenge, and a state of up to 200 characters) is answered with an error
 *    in the redirect, the way OAuth does, so the sheet closes with a reason.
 *    This comes before Google, so a request that cannot work never leaves.
 * 3. Then Google, or the code.
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

  if (user) {
    const code = await issueSignInCode(user.id, challenge, redirectUri);
    return seeOther(withParams(redirectUri, { code, state }));
  }

  // Signing in redirects by throwing (Next's NEXT_REDIRECT), and that throw is
  // the answer, so nothing here may catch it. The way back is a path on this
  // site and not an address: Auth.js only follows one that is on the same origin.
  return signIn("google", { redirectTo: url.pathname + url.search });
}
