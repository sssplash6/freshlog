import { encode } from "next-auth/jwt";

import { devLoginEnabled } from "@/lib/dev-login";
import { prisma } from "@/lib/prisma";

// Reads the database and the environment on every request; never prerender.
export const dynamic = "force-dynamic";

const COOKIE = "authjs.session-token";
const MAX_AGE = 60 * 60 * 8;

/**
 * Sign in as anybody in the local database, without Google: `GET
 * /api/dev-login` lists the accounts, `?email=…` signs in as one.
 *
 * Google refuses automated browsers and a fresh local database holds accounts
 * nobody has the Google login for, so checking a page as a student, a mentor
 * and an admin meant hand-minting a cookie each time. This mints it the same
 * way Auth.js does (same secret, same salt, same cookie name), so the DAL reads
 * it exactly like a real sign-in and every gate still runs on the account's
 * real role and status.
 *
 * For when it is on, see `devLoginEnabled` in src/lib/dev-login.ts.
 */
export async function GET(request: Request) {
  if (!devLoginEnabled(request)) {
    return new Response("Not found.", { status: 404 });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get("email")?.trim().toLowerCase();
  const key = url.searchParams.get("key");

  if (!email) {
    const users = await prisma.user.findMany({
      orderBy: [{ role: "asc" }, { email: "asc" }],
      select: { email: true, name: true, role: true, status: true },
    });
    return new Response(page(users, key), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return new Response(`No local account for ${email}.`, { status: 404 });

  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) return new Response("NEXTAUTH_SECRET is not set.", { status: 500 });

  const token = await encode({
    token: { sub: user.id, uid: user.id, email: user.email, name: user.name },
    secret,
    salt: COOKIE,
    maxAge: MAX_AGE,
  });

  const headers = new Headers({ Location: "/", "Cache-Control": "no-store" });
  headers.append(
    "Set-Cookie",
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}`
  );
  return new Response(null, { status: 303, headers });
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(
  users: { email: string; name: string | null; role: string; status: string }[],
  key: string | null
): string {
  const carry = key ? `&key=${encodeURIComponent(key)}` : "";
  const rows = users
    .map(
      (u) =>
        `<li><a href="/api/dev-login?email=${encodeURIComponent(u.email)}${carry}">${escape(
          u.name ?? u.email
        )}</a> <span>${escape(u.email)} · ${u.role.toLowerCase()}${
          u.status === "ACTIVE" ? "" : ` · ${u.status.toLowerCase()}`
        }</span></li>`
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Local sign-in</title>
<style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1a2733}
h1{font-size:1.5rem}ul{list-style:none;padding:0}li{padding:.5rem 0;border-bottom:1px solid #e5e6e8}
a{color:#124b84;font-weight:600;text-decoration:none}span{display:block;color:#6b7480;font-size:13px}</style>
<h1>Sign in as…</h1><p>Local only. Every page still checks this account's real role.</p><ul>${rows}</ul>`;
}
