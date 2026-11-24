/**
 * Where to send somebody after they sign in, when the address came from a
 * URL anybody can write (`/login?next=…`).
 *
 * Only a path on this site: "/sessions/new?minutes=47". Never another site —
 * "//evil.example" and "/\evil.example" are both read by browsers as another
 * host, and an open redirect behind a Google sign-in is a phishing kit. Never
 * the login page itself, which would send a fresh sign-in round in a circle.
 */
const MAX_LENGTH = 4000;

export function safeNext(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return undefined;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return undefined;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return undefined;
  // Parsed against a placeholder host: anything that resolves elsewhere is out.
  const url = new URL(raw, "https://freshlog.invalid");
  if (url.host !== "freshlog.invalid") return undefined;
  if (url.pathname === "/login" || url.pathname.startsWith("/api/auth")) return undefined;
  return `${url.pathname}${url.search}`;
}

/** The login address that comes back to `path` afterwards. */
export function loginFor(path: string): string {
  const next = safeNext(path);
  return next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login";
}
