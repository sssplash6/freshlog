import { bearerFrom, revokeToken } from "@/lib/api/tokens";
import { noContent } from "@/lib/api/v1/respond";

// Reads the database on every request; never prerender. On Render the SQLite
// disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * Ends the sign-in whose token this request carries.
 *
 * It answers 204 whatever it is sent: no header, another scheme, a token nobody
 * was given, one already ended. Either way the app is left signed out, and an
 * answer that said which would only tell a stranger which tokens exist. A
 * database that cannot be written is the one exception, and it is a 500 on
 * purpose: a 204 there would say a token was ended that still works.
 */
export async function POST(request: Request) {
  // This ends a sign-in, so it needs no session: whoever holds the token may end
  // it, and the token is all that is read.
  const token = bearerFrom(request.headers.get("authorization"));
  if (token) await revokeToken(token);
  return noContent();
}
