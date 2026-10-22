/**
 * Where a sign-in may send a person back to, and what a PKCE challenge looks like.
 *
 * `/api/v1/auth/start` hands a one-time code to whatever address the request
 * names, so the address is the one thing it must not take on trust. PKCE is the
 * second wall, not the first: a code sent anywhere else would be useless without
 * the app's verifier, and it should still never be sent.
 */

/** Plain printable ASCII: nothing invisible, and nothing a header cannot carry. */
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

/**
 * The app's own scheme is always allowed. `exp://` is Expo Go's, which is how the
 * app is run while it is being built: it is allowed only while
 * `API_ALLOW_EXPO_REDIRECTS` is exactly `1`, which is set locally, and on
 * staging only while staging holds sample data; never in production. Expo Go
 * hands an `exp://` sign-in to whichever project opened the sheet, so no list of
 * allowed addresses makes it safe: a server that allows it must hold nothing real.
 * Nothing on the web is ever allowed.
 *
 * The address ends up in a `Location` header as it is written, so one with a
 * space, a line break or a character outside printable ASCII is refused too: it
 * is not an address the app would have sent.
 */
export function allowedRedirect(uri: string): boolean {
  if (!PRINTABLE_ASCII.test(uri)) return false;
  if (uri.startsWith("freshlog://")) return true;
  return uri.startsWith("exp://") && process.env.API_ALLOW_EXPO_REDIRECTS === "1";
}

/**
 * A PKCE challenge made with S256 (RFC 7636 §4.2): the unpadded base64url of a
 * SHA-256, which is always 43 characters. Plain base64 and padding are not it.
 */
export const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
