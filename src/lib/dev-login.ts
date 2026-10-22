import { timingSafeEqual } from "node:crypto";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Whether this request may use the sample-account sign-in. Both /api/dev-login
 * and /api/v1/auth/dev ask before they do anything else.
 *
 * OFF unless BOTH hold, and it answers 404 otherwise — the same answer as an
 * address that does not exist:
 *
 *   DEV_LOGIN=1   set only by `npm run start:local` / `npm run dev:local`. It is
 *                 never in `.env`, so a deploy cannot inherit it.
 *   localhost     the request's own host, AND no proxy in front claiming to
 *                 forward it — a public deploy sits behind one, and a spoofed
 *                 Host header on a server that somehow had the flag still
 *                 carries the proxy's X-Forwarded-Host.
 *
 * SHARING through a tunnel is the one exception, and it needs a secret:
 * start the server with DEV_LOGIN_KEY=<random> as well, and a request from
 * anywhere is let in only when it carries `?key=<that value>`. The key rides
 * every link on the list page, so a friend given one URL can move between
 * accounts. Without the variable, the localhost rule above is the only door.
 */
export function devLoginEnabled(request: Request): boolean {
  if (process.env.DEV_LOGIN !== "1") return false;
  const shared = process.env.DEV_LOGIN_KEY;
  const given = new URL(request.url).searchParams.get("key");
  if (shared && shared.length >= 16 && given && sameSecret(given, shared)) return true;
  const headers = request.headers;
  if (headers.get("x-forwarded-host") && !isLocal(headers.get("x-forwarded-host")!)) {
    return false;
  }
  return isLocal(headers.get("host") ?? new URL(request.url).host);
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function isLocal(host: string): boolean {
  const name = host.replace(/:\d+$/, "");
  return LOCAL_HOSTS.has(name);
}
